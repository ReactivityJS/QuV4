// Milestone M2 (docs/rewrite-plan.md's Verification section): "Live-Update
// zwischen zwei Tabs, Offline/Reconnect verlustfrei", with a test for all
// three event-durability variants. "Two tabs" here means two ApClient
// instances representing the *same* actor's own devices — each with its
// own separate local ap-store (own MemoryStoreAdapter, own IndexedDB-
// equivalent), talking to one relay's authoritative store over a real
// WebSocket connection. Nothing is mocked below the ApClient/relay
// boundary: real HTTP server, real `ws` sockets, real ap-store instances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter, QuEvents } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { LocalVault, MemoryVaultAdapter } from '@qu/local-vault';
import { DURABILITY } from '@qu/as2';
import { WebSocketClientTransport } from '@qu/ap-realtime';
import { ApClient } from '@qu/ap-client';
import { ensureLocalActor } from '../src/local-actor.js';
import { ActorRegistry } from '../src/registry.js';
import { createRealtimeBridge } from '../src/realtime-bridge.js';

async function startRelay() {
  const relayEvents = new QuEvents();
  const relayStore = new ApStore({ adapter: new MemoryStoreAdapter(), events: relayEvents });
  const vault = new LocalVault(new MemoryVaultAdapter());

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;

  const alice = await ensureLocalActor({ vault, host, username: 'alice' });
  const registry = new ActorRegistry();
  registry.register(alice);

  const bridge = createRealtimeBridge({ server, store: relayStore, events: relayEvents, registry });

  return {
    store: relayStore,
    actor: alice.actor,
    wsUrl: `ws://${host}/realtime`,
    close: async () => {
      bridge.close();
      server.close();
      await once(server, 'close');
    },
  };
}

function openTab(wsUrl, actorId) {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const transport = new WebSocketClientTransport({ url: wsUrl });
  const client = new ApClient({ store, transport, actorId });
  return { store, client };
}

test('M2: object/persistent — a publish on one tab appears live on the other', async () => {
  const relay = await startRelay();
  const settings = `${relay.actor.id}/settings`;
  const tabA = openTab(relay.wsUrl, relay.actor.id);
  const tabB = openTab(relay.wsUrl, relay.actor.id);

  try {
    await tabA.client.connect();
    await tabB.client.connect();

    const seenOnB = [];
    tabB.client.watchChildren(settings, (docs) => seenOnB.push(docs.length));
    await sleep(20);

    await tabA.client.publish({
      id: `${relay.actor.id}/settings/theme`,
      type: 'qu:Setting',
      fields: { value: 'dark' },
      collections: [settings],
    });
    await sleep(40);

    const doc = await tabB.store.get(`${relay.actor.id}/settings/theme`);
    assert.equal(doc?.value, 'dark');
    assert.ok(seenOnB.includes(1));
  } finally {
    tabA.client.close();
    tabB.client.close();
    await relay.close();
  }
});

test('M2: offline/reconnect is lossless — a disconnected tab catches up via resume, no loss, no duplication', async () => {
  const relay = await startRelay();
  const settings = `${relay.actor.id}/settings`;
  const tabA = openTab(relay.wsUrl, relay.actor.id);
  const tabB = openTab(relay.wsUrl, relay.actor.id);

  try {
    await tabA.client.connect();
    await tabB.client.connect();
    tabB.client.subscribe(settings);
    await sleep(20);

    // 1. Both online: a first change reaches B live.
    await tabA.client.publish({
      id: `${relay.actor.id}/settings/a`,
      type: 'qu:Setting',
      fields: { value: 1 },
      collections: [settings],
    });
    await sleep(30);
    assert.equal((await tabB.store.get(`${relay.actor.id}/settings/a`))?.value, 1);

    // 2. B goes offline.
    tabB.client.close();
    await sleep(20);

    // 3. While B is offline, A publishes twice more.
    await tabA.client.publish({
      id: `${relay.actor.id}/settings/b`,
      type: 'qu:Setting',
      fields: { value: 2 },
      collections: [settings],
    });
    await tabA.client.publish({
      id: `${relay.actor.id}/settings/c`,
      type: 'qu:Setting',
      fields: { value: 3 },
      collections: [settings],
    });
    await sleep(30);

    // B has missed both — proving the "offline" part of the scenario is real.
    assert.equal(await tabB.store.get(`${relay.actor.id}/settings/b`), null);
    assert.equal(await tabB.store.get(`${relay.actor.id}/settings/c`), null);

    // 4. B reconnects: resume must deliver exactly what was missed.
    await tabB.client.connect();
    await sleep(40);

    assert.equal((await tabB.store.get(`${relay.actor.id}/settings/a`))?.value, 1);
    assert.equal((await tabB.store.get(`${relay.actor.id}/settings/b`))?.value, 2);
    assert.equal((await tabB.store.get(`${relay.actor.id}/settings/c`))?.value, 3);

    const settled = await tabB.store.getChildren(settings, { limit: 50 });
    assert.equal(settled.length, 3); // no duplicates from overlapping live + resume delivery
  } finally {
    tabA.client.close();
    tabB.client.close();
    await relay.close();
  }
});

test('M2: ephemeral frames are live-only — never persisted, never replayed on reconnect', async () => {
  const relay = await startRelay();
  const signals = `${relay.actor.id}/signals`;
  const tabA = openTab(relay.wsUrl, relay.actor.id);
  const tabB = openTab(relay.wsUrl, relay.actor.id);

  try {
    await tabA.client.connect();
    await tabB.client.connect();
    tabB.client.subscribe(signals);
    await sleep(20);

    // Live: B does NOT actually receive it as a stored doc (ephemeral is
    // never persisted server-side either, so there is nothing to
    // broadcast from — see ApStore's ephemeral dedup-only behavior).
    await tabA.client.publish({
      id: `${relay.actor.id}/signals/offer-1`,
      type: 'qu:Signal',
      durability: DURABILITY.EPHEMERAL,
      fields: { sdp: 'v=0...' },
      collections: [signals],
    });
    await sleep(30);
    assert.equal(await relay.store.get(`${relay.actor.id}/signals/offer-1`), null);
    assert.equal(await tabB.store.get(`${relay.actor.id}/signals/offer-1`), null);

    // Reconnect: resume() has nothing to replay for `signals` either.
    tabB.client.close();
    await sleep(20);
    await tabB.client.connect();
    await sleep(30);
    assert.deepEqual(await tabB.store.getChildren(signals), []);
  } finally {
    tabA.client.close();
    tabB.client.close();
    await relay.close();
  }
});

test('M2: session frames are live-only — visible to connected peers, never replayed to a later joiner', async () => {
  const relay = await startRelay();
  const cursors = `${relay.actor.id}/collab/cursors`;
  const tabA = openTab(relay.wsUrl, relay.actor.id);
  const tabB = openTab(relay.wsUrl, relay.actor.id);

  try {
    await tabA.client.connect();
    await tabB.client.connect();
    tabB.client.subscribe(cursors);
    await sleep(20);

    const SESSION_ID = 'edit-session-1';
    await tabA.client.publish({
      id: `${relay.actor.id}/collab/cursors/a`,
      type: 'qu:Cursor',
      durability: DURABILITY.SESSION,
      sessionId: SESSION_ID,
      fields: { line: 42 },
      collections: [cursors],
    });
    await sleep(30);

    // B, already connected and subscribed, saw it live. Session-durability
    // data never lands in the regular object store (get()/getChildren()
    // are persistent-only) — it's only visible via getSessionChildren().
    assert.equal(await tabB.store.get(`${relay.actor.id}/collab/cursors/a`), null);
    const bSessionView = await tabB.store.getSessionChildren(SESSION_ID, cursors);
    assert.equal(bSessionView.length, 1);
    assert.equal(bSessionView[0].line, 42);

    // A third tab joining afterward never sees it via resume — session
    // data has no replay semantics for later joiners, by design.
    const tabC = openTab(relay.wsUrl, relay.actor.id);
    tabC.client.subscribe(cursors);
    await tabC.client.connect();
    await sleep(30);
    assert.deepEqual(await tabC.store.getSessionChildren(SESSION_ID, cursors), []);
    assert.deepEqual(await tabC.store.getChildren(cursors), []);
    tabC.client.close();
  } finally {
    tabA.client.close();
    tabB.client.close();
    await relay.close();
  }
});
