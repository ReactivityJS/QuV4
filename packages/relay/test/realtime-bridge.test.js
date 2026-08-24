import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter, QuEvents } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { LocalVault, MemoryVaultAdapter } from '@qu/local-vault';
import { WebSocketClientTransport, buildControlFrame, buildDataFrame, CONTROL_OP, isControlFrame } from '@qu/ap-realtime';
import { DURABILITY } from '@qu/as2';
import { ensureLocalActor } from '../src/local-actor.js';
import { ActorRegistry } from '../src/registry.js';
import { createRealtimeBridge } from '../src/realtime-bridge.js';

async function withBridge(run) {
  const bus = new QuEvents();
  const sharedStore = new ApStore({ adapter: new MemoryStoreAdapter(), events: bus });

  const vault = new LocalVault(new MemoryVaultAdapter());
  const otherVault = new LocalVault(new MemoryVaultAdapter());

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;

  const alice = await ensureLocalActor({ vault, host, username: 'alice' });
  const bob = await ensureLocalActor({ vault: otherVault, host, username: 'bob' });
  const registry = new ActorRegistry();
  registry.register(alice);
  registry.register(bob);

  const bridge = createRealtimeBridge({ server, store: sharedStore, events: bus, registry });

  try {
    await run({ store: sharedStore, events: bus, alice, bob, registry, bridge, url: `ws://${host}/realtime` });
  } finally {
    bridge.close();
    server.close();
    await once(server, 'close');
  }
}

function makeClient(url) {
  return new WebSocketClientTransport({ url });
}

async function connectAs(url, actorId) {
  const client = makeClient(url);
  const received = [];
  client.onMessage((f) => received.push(f));
  await client.connect();
  client.send(buildControlFrame(CONTROL_OP.HELLO, { actorId }));
  await sleep(20);
  return { client, received };
}

test('control frames before hello are ignored', async () => {
  await withBridge(async ({ alice, url }) => {
    const client = makeClient(url);
    await client.connect();
    client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    await sleep(20);
    // no crash, nothing observable to assert other than "still connected"
    assert.equal(client.getPeerId(), null);
    client.close();
  });
});

test('hello with an unknown actorId closes the connection', async () => {
  await withBridge(async ({ url }) => {
    const client = makeClient(url);
    let closed = false;
    client.onClose(() => {
      closed = true;
    });
    await client.connect();
    client.send(buildControlFrame(CONTROL_OP.HELLO, { actorId: 'https://nowhere.example/actors/ghost' }));
    await sleep(30);
    assert.equal(closed, true);
  });
});

test('a subscribed peer receives a live broadcast for a matching collection', async () => {
  await withBridge(async ({ store, alice, url }) => {
    const { client, received } = await connectAs(url, alice.actor.id);
    client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    await sleep(20);

    await store.put({ id: 'https://relay.example/note/1', type: 'Note' }, { collections: [alice.actor.outbox] });
    await sleep(20);

    const dataFrames = received.filter((f) => !isControlFrame(f));
    assert.equal(dataFrames.length, 1);
    assert.equal(dataFrames[0].id, 'https://relay.example/note/1');
    client.close();
  });
});

test('a peer does not receive changes for a collection it is not subscribed to', async () => {
  await withBridge(async ({ store, alice, url }) => {
    const { client, received } = await connectAs(url, alice.actor.id);
    client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    await sleep(20);

    await store.put({ id: 'https://relay.example/note/1' }, { collections: [alice.actor.inbox] });
    await sleep(20);

    assert.deepEqual(received.filter((f) => !isControlFrame(f)), []);
    client.close();
  });
});

test('resume replays subscribed collection history and sends a resumed frame', async () => {
  await withBridge(async ({ store, alice, url }) => {
    await store.put({ id: 'https://relay.example/note/1' }, { collections: [alice.actor.outbox], ts: 1000 });

    const { client, received } = await connectAs(url, alice.actor.id);
    client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    client.send(buildControlFrame(CONTROL_OP.RESUME, { since: {} }));
    await sleep(30);

    const dataFrames = received.filter((f) => !isControlFrame(f));
    assert.equal(dataFrames.length, 1);
    assert.equal(dataFrames[0].id, 'https://relay.example/note/1');

    const resumed = received.find((f) => isControlFrame(f) && f.op === CONTROL_OP.RESUMED);
    assert.ok(resumed);
    client.close();
  });
});

test('a peer publishing a data frame under its own actor gets it persisted and echoed', async () => {
  await withBridge(async ({ store, alice, url }) => {
    const { client, received } = await connectAs(url, alice.actor.id);
    client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    await sleep(20);

    const frame = buildDataFrame({
      id: 'https://relay.example/note/2',
      doc: { id: 'https://relay.example/note/2', type: 'Note', content: 'from client' },
      collections: [alice.actor.outbox],
      durability: DURABILITY.PERSISTENT,
    });
    client.send(frame);
    await sleep(30);

    assert.deepEqual(await store.get('https://relay.example/note/2'), frame.doc);
    const dataFrames = received.filter((f) => !isControlFrame(f));
    assert.equal(dataFrames.length, 1);
    client.close();
  });
});

test('a peer cannot publish under a collection belonging to a different actor', async () => {
  await withBridge(async ({ store, alice, bob, url }) => {
    const { client } = await connectAs(url, alice.actor.id);

    const frame = buildDataFrame({
      id: 'https://relay.example/note/3',
      doc: { id: 'https://relay.example/note/3' },
      collections: [bob.actor.outbox],
      durability: DURABILITY.PERSISTENT,
    });
    client.send(frame);
    await sleep(20);

    assert.equal(await store.get('https://relay.example/note/3'), null);
    client.close();
  });
});

test('two peers for the same actor ("two tabs") both see a change published by either', async () => {
  await withBridge(async ({ store, alice, url }) => {
    const tabA = await connectAs(url, alice.actor.id);
    const tabB = await connectAs(url, alice.actor.id);
    tabA.client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    tabB.client.send(buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: alice.actor.outbox }));
    await sleep(20);

    await store.put({ id: 'https://relay.example/note/4' }, { collections: [alice.actor.outbox] });
    await sleep(20);

    assert.equal(tabA.received.filter((f) => !isControlFrame(f)).length, 1);
    assert.equal(tabB.received.filter((f) => !isControlFrame(f)).length, 1);
    tabA.client.close();
    tabB.client.close();
  });
});

test('peerCount tracks connected clients', async () => {
  await withBridge(async ({ bridge, alice, url }) => {
    assert.equal(bridge.peerCount(), 0);
    const { client } = await connectAs(url, alice.actor.id);
    assert.equal(bridge.peerCount(), 1);
    client.close();
    await sleep(30);
    assert.equal(bridge.peerCount(), 0);
  });
});

test('requires server, store, events and registry', () => {
  assert.throws(() => createRealtimeBridge({}));
});
