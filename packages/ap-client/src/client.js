// ApClient — `publish()`/`watch()`, the one API app authors use regardless
// of data class (see docs/rewrite-plan.md decision 9). Writes always go to
// the local `ap-store` first (optimistic, works offline); a `persistent`
// write additionally queues in a durable local outbox until it's actually
// handed to the transport. `ephemeral`/`session` writes are best-effort —
// live-only, never queued, matching their durability tier's own contract.
//
// On every connect (initial or reconnect), the order is always: hello ->
// re-subscribe -> resume{since} -> flush outbox -> trust the live stream.
// That's the offline-first rule from the plan's addendum, applied
// literally: reconnect always resumes before/while the realtime channel
// comes back up.
//
// Known simplification: reconnect itself (detecting a drop and calling
// connect() again, with backoff) is the caller's responsibility here —
// this class reacts correctly to being reconnected, but doesn't loop and
// retry on its own yet.

import { DURABILITY, mintId } from '@qu/as2';
import { watch, watchChildren } from '@qu/reactive';
import { buildControlFrame, buildDataFrame, isControlFrame, isDataFrame, CONTROL_OP } from '@qu/ap-realtime';

const OUTBOX_COLLECTION_PREFIX = 'urn:qu:client-outbox:';
const OUTBOX_ENTRY_PREFIX = 'urn:qu:outbox-entry:';
const CURSOR_PREFIX = 'urn:qu:client-cursor:';

export class ApClient {
  #store;
  #transport;
  #actorId;
  #actorBase;
  #outboxCollection;
  #subscriptions = new Set();
  #connected = false;

  /**
   * @param {object} params
   * @param {object} params.store - the local ap-store (this device's full offline-first copy)
   * @param {object} params.transport - a client Transport (WebSocketClientTransport, ...)
   * @param {string} params.actorId - this client's own actor id
   * @param {string} [params.actorBase] - base URL for minting new object ids, default actorId
   */
  constructor({ store, transport, actorId, actorBase = actorId }) {
    if (!store) throw new Error('ApClient: store is required');
    if (!transport) throw new Error('ApClient: transport is required');
    if (!actorId) throw new Error('ApClient: actorId is required');
    this.#store = store;
    this.#transport = transport;
    this.#actorId = actorId;
    this.#actorBase = actorBase;
    this.#outboxCollection = `${OUTBOX_COLLECTION_PREFIX}${actorId}`;

    this.#transport.onMessage((frame) => this.#handleFrame(frame));
    this.#transport.onClose(() => {
      this.#connected = false;
    });
  }

  /** Connect (or reconnect): hello, re-subscribe, resume, then flush anything queued offline. */
  async connect() {
    await this.#transport.connect();
    this.#connected = true;
    this.#transport.send(buildControlFrame(CONTROL_OP.HELLO, { actorId: this.#actorId }));
    for (const collectionId of this.#subscriptions) {
      this.#transport.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId }));
    }
    await this.#resume();
    await this.#flushOutbox();
  }

  isConnected() {
    return this.#connected;
  }

  close() {
    this.#transport.close();
  }

  /**
   * The one write API, for any data class.
   *
   * @param {object} params
   * @param {string} [params.id] - explicit id; minted under actorBase if omitted
   * @param {string} params.type - AS2 type (e.g. 'Note', 'Follow', ...)
   * @param {object} [params.fields] - extra AS2 fields merged onto the document
   * @param {string|string[]} [params.visibility] - convenience for `to`
   * @param {string} [params.durability] - one of DURABILITY, default 'persistent'
   * @param {string[]} [params.collections] - collection ids to index this under
   * @param {string} [params.sessionId] - required when durability === 'session'
   * @returns {Promise<object>} the published AS2 document
   */
  async publish({ id, type, fields = {}, visibility, durability = DURABILITY.PERSISTENT, collections = [], sessionId } = {}) {
    if (!type) throw new Error('ApClient.publish: type is required');
    const docId = id ?? mintId({ actorBase: this.#actorBase, collection: 'objects' });
    const doc = { id: docId, type, ...fields };
    if (visibility !== undefined) doc.to = Array.isArray(visibility) ? visibility : [visibility];

    const ts = Date.now();
    await this.#store.put(doc, { collections, durability, sessionId, ts });

    if (durability !== DURABILITY.PERSISTENT) {
      // Best-effort live send only — ephemeral/session data is never queued for later.
      if (this.#connected) {
        try {
          this.#transport.send(buildDataFrame({ id: docId, doc, collections, durability, sessionId }));
        } catch {
          // dropped mid-send; that's within an ephemeral/session frame's contract
        }
      }
      return doc;
    }

    await this.#enqueueOutbox({ id: docId, doc, collections, ts });
    if (this.#connected) await this.#flushOutbox();
    return doc;
  }

  /** Watch a single document by id. Thin wrapper over packages/reactive against the local store. */
  watch(id, callback) {
    return watch(this.#store, id, callback);
  }

  /** Watch a collection's members, also subscribing for live server-side updates while watched. */
  watchChildren(collectionId, callback, options) {
    this.subscribe(collectionId);
    const unwatch = watchChildren(this.#store, collectionId, callback, options);
    return () => {
      unwatch();
      this.unsubscribe(collectionId);
    };
  }

  /** Number of persistent writes still waiting to be handed to the transport. */
  async outboxSize() {
    const entries = await this.#store.getChildren(this.#outboxCollection, { limit: Infinity });
    return entries.length;
  }

  subscribe(collectionId) {
    if (this.#subscriptions.has(collectionId)) return;
    this.#subscriptions.add(collectionId);
    if (this.#connected) {
      this.#transport.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId }));
    }
  }

  unsubscribe(collectionId) {
    if (!this.#subscriptions.delete(collectionId)) return;
    if (this.#connected) {
      this.#transport.send(buildControlFrame(CONTROL_OP.UNSUBSCRIBE, { collectionId }));
    }
  }

  async #resume() {
    const since = {};
    for (const collectionId of this.#subscriptions) {
      since[collectionId] = await this.#getCursor(collectionId);
    }
    this.#transport.send(buildControlFrame(CONTROL_OP.RESUME, { since }));
  }

  async #handleFrame(frame) {
    if (isControlFrame(frame)) {
      if (frame.op === CONTROL_OP.RESUMED) {
        for (const [collectionId, cursor] of Object.entries(frame.cursors ?? {})) {
          if (cursor) await this.#setCursor(collectionId, cursor);
        }
      }
      return;
    }

    if (isDataFrame(frame)) {
      await this.#store.put(frame.doc, {
        collections: frame.collections,
        durability: frame.durability,
        sessionId: frame.sessionId,
      });
      if (frame.cursor) {
        for (const collectionId of frame.collections ?? []) {
          if (this.#subscriptions.has(collectionId)) await this.#setCursor(collectionId, frame.cursor);
        }
      }
    }
  }

  async #enqueueOutbox({ id, doc, collections, ts }) {
    const entryId = `${OUTBOX_ENTRY_PREFIX}${id}`;
    await this.#store.put(
      { id: entryId, targetId: id, doc, collections, ts },
      { collections: [this.#outboxCollection], durability: DURABILITY.PERSISTENT, ts },
    );
  }

  async #flushOutbox() {
    const entries = await this.#store.getChildren(this.#outboxCollection, { limit: Infinity });
    // Oldest-first, matching the order they were originally published in.
    for (const entry of [...entries].reverse()) {
      const frame = buildDataFrame({
        id: entry.targetId,
        doc: entry.doc,
        collections: entry.collections,
        durability: DURABILITY.PERSISTENT,
        ts: entry.ts,
      });
      try {
        this.#transport.send(frame);
        await this.#store.delete(entry.id);
      } catch {
        break; // likely disconnected mid-flush; the rest stay queued for next time
      }
    }
  }

  async #getCursor(collectionId) {
    const doc = await this.#store.get(`${CURSOR_PREFIX}${collectionId}`);
    return doc?.cursor ?? null;
  }

  async #setCursor(collectionId, cursor) {
    await this.#store.put({ id: `${CURSOR_PREFIX}${collectionId}`, cursor }, { durability: DURABILITY.PERSISTENT });
  }
}
