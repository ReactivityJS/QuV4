// The realtime bridge: wires a WebSocketServerTransport onto QuRelay's
// existing HTTP server (same process, same port — see docs/rewrite-plan.md
// "QuRelay = AP-Server und Qu-Erweiterung in einem Deployment") and
// connects it to ap-store. This is the live-update half of the offline-
// first story; ap-router.js's inbox/outbox routes remain the durable,
// always-available fallback.
//
// Protocol, per connected peer:
//   1. client sends a 'hello' control frame {actorId} — identifies whose
//      store view this connection gets. (Trusting the claimed actorId
//      outright is a known simplification: there is no session/auth layer
//      yet. A real deployment must verify this, e.g. against a signed
//      session token, before shipping.)
//   2. client sends 'subscribe'/'unsubscribe' control frames per
//      collection it wants live updates for.
//   3. client sends 'resume' {since} to replay anything missed while
//      disconnected (see @qu/ap-realtime's replayResume) — always call
//      this before/while trusting the live stream, per the offline-first
//      rule.
//   4. client may send ordinary data frames to publish: the bridge
//      authorizes (the frame's collections must belong to the peer's own
//      actor) and persists via store.put(), which — because everyone
//      shares the *same* QuEvents bus — naturally re-broadcasts to every
//      subscribed peer, sender included (a harmless, idempotent echo:
//      ap-store.put() replaces rather than duplicates on re-apply).

import {
  WebSocketServerTransport,
  buildDataFrame,
  isControlFrame,
  isDataFrame,
  replayResume,
  CONTROL_OP,
} from '@qu/ap-realtime';

/**
 * @param {object} params
 * @param {import('node:http').Server} params.server
 * @param {{ getChildren: Function, getChildrenSince: Function, put: Function, onChange: Function }} params.store
 * @param {import('@qu/core').QuEvents} params.events - the shared bus store.put() emits 'change' on
 * @param {import('./registry.js').ActorRegistry} params.registry
 * @param {string} [params.path] - default '/realtime'
 */
export function createRealtimeBridge({ server, store, events, registry, path = '/realtime' }) {
  if (!server) throw new Error('createRealtimeBridge: server is required');
  if (!store) throw new Error('createRealtimeBridge: store is required');
  if (!events) throw new Error('createRealtimeBridge: events is required');
  if (!registry) throw new Error('createRealtimeBridge: registry is required');

  const transport = new WebSocketServerTransport({ server, path });
  const peerState = new Map(); // peerId -> { actorId: string|null, subscriptions: Set<string> }

  function isOwnCollection(actorId, collectionId) {
    return typeof collectionId === 'string' && collectionId.startsWith(actorId);
  }

  transport.onConnection((peerId, peer) => {
    const state = { actorId: null, subscriptions: new Set() };
    peerState.set(peerId, state);

    peer.onMessage(async (frame) => {
      if (isControlFrame(frame)) {
        if (frame.op === CONTROL_OP.HELLO) {
          const record = registry.byId(frame.actorId);
          if (!record) {
            peer.close();
            return;
          }
          state.actorId = frame.actorId;
          return;
        }

        if (!state.actorId) return; // ignore anything before a valid hello

        if (frame.op === CONTROL_OP.SUBSCRIBE) {
          state.subscriptions.add(frame.collectionId);
          return;
        }
        if (frame.op === CONTROL_OP.UNSUBSCRIBE) {
          state.subscriptions.delete(frame.collectionId);
          return;
        }
        if (frame.op === CONTROL_OP.RESUME) {
          await replayResume({
            store,
            subscriptions: [...state.subscriptions],
            since: frame.since ?? {},
            send: (f) => peer.send(f),
          });
          return;
        }
        return;
      }

      if (isDataFrame(frame) && state.actorId) {
        const collections = frame.collections ?? [];
        const authorized = collections.every((c) => isOwnCollection(state.actorId, c));
        if (!authorized) return;
        await store.put(frame.doc, {
          collections,
          durability: frame.durability,
          sessionId: frame.sessionId,
        });
      }
    });

    peer.onClose(() => peerState.delete(peerId));
  });

  const unsubscribeChange = events.on('change', (event) => {
    const frame = buildDataFrame(event);
    for (const [peerId, state] of peerState) {
      if (!state.actorId) continue;
      const relevant = (event.collections ?? []).some((c) => state.subscriptions.has(c));
      if (relevant) transport.sendTo(peerId, frame);
    }
  });

  return {
    peerCount: () => transport.peerCount(),
    close: () => {
      unsubscribeChange();
      transport.close();
    },
  };
}
