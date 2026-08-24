import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStoreAdapter, generateX25519Keypair } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { DURABILITY } from '@qu/as2';
import { encodeX25519Multikey, decryptPayload } from '@qu/ap-encryption';
import { isControlFrame, isDataFrame, CONTROL_OP, buildControlFrame } from '@qu/ap-realtime';
import { ApClient } from '../src/client.js';
import { FakeTransport } from './fake-transport.js';

const ACTOR_ID = 'https://relay.example/actors/alice';
const OUTBOX = `${ACTOR_ID}/outbox`;

function makeClient(overrides = {}) {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const transport = new FakeTransport();
  const client = new ApClient({ store, transport, actorId: ACTOR_ID, ...overrides });
  return { store, transport, client };
}

test('requires store, transport and actorId', () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const transport = new FakeTransport();
  assert.throws(() => new ApClient({ transport, actorId: ACTOR_ID }));
  assert.throws(() => new ApClient({ store, actorId: ACTOR_ID }));
  assert.throws(() => new ApClient({ store, transport }));
});

test('publish() requires a type', async () => {
  const { client } = makeClient();
  await assert.rejects(() => client.publish({}));
});

test('publish() writes to the local store immediately, even while disconnected', async () => {
  const { store, client } = makeClient();
  const doc = await client.publish({ type: 'Note', fields: { content: 'hi' }, allowUnencryptedPrivate: true });
  assert.equal(doc.type, 'Note');
  assert.equal(doc.content, 'hi');
  assert.deepEqual(await store.get(doc.id), doc);
});

test('publish() sets `to` from visibility', async () => {
  const { client } = makeClient();
  const doc = await client.publish({
    type: 'Note',
    visibility: 'https://relay.example/followers',
    allowUnencryptedPrivate: true,
  });
  assert.deepEqual(doc.to, ['https://relay.example/followers']);
});

test('an explicit id is honored instead of minting one', async () => {
  const { client } = makeClient();
  const doc = await client.publish({ id: 'https://relay.example/objects/fixed', type: 'Note', allowUnencryptedPrivate: true });
  assert.equal(doc.id, 'https://relay.example/objects/fixed');
});

test('a persistent publish while disconnected queues in the outbox, not sent', async () => {
  const { client, transport } = makeClient();
  await client.publish({ type: 'Note', collections: [OUTBOX], allowUnencryptedPrivate: true });
  assert.deepEqual(transport.sent, []);
  assert.equal(await client.outboxSize(), 1);
});

test('connecting flushes the queued outbox entry', async () => {
  const { client, transport } = makeClient();
  await client.publish({ type: 'Note', collections: [OUTBOX], allowUnencryptedPrivate: true });
  await client.connect();

  const dataFrames = transport.sent.filter(isDataFrame);
  assert.equal(dataFrames.length, 1);
  assert.equal(await client.outboxSize(), 0);
});

test('a persistent publish while already connected is sent immediately, outbox stays empty', async () => {
  const { client, transport } = makeClient();
  await client.connect();
  transport.sent.length = 0; // clear the hello/resume noise from connect()

  await client.publish({ type: 'Note', collections: [OUTBOX], allowUnencryptedPrivate: true });
  assert.equal(transport.sent.filter(isDataFrame).length, 1);
  assert.equal(await client.outboxSize(), 0);
});

test('repeated offline edits to the same id collapse into a single outbox entry', async () => {
  const { client } = makeClient();
  await client.publish({ id: 'https://relay.example/objects/x', type: 'Note', fields: { content: 'v1' }, allowUnencryptedPrivate: true });
  await client.publish({ id: 'https://relay.example/objects/x', type: 'Note', fields: { content: 'v2' }, allowUnencryptedPrivate: true });
  assert.equal(await client.outboxSize(), 1);
});

test('ephemeral publish never queues, and is dropped silently if disconnected', async () => {
  const { client, transport } = makeClient();
  await assert.doesNotReject(() =>
    client.publish({
      type: 'qu:Signal',
      durability: DURABILITY.EPHEMERAL,
      fields: { kind: 'offer' },
      allowUnencryptedPrivate: true,
    }),
  );
  assert.equal(await client.outboxSize(), 0);
  assert.deepEqual(transport.sent, []);
});

test('ephemeral publish sends live when connected', async () => {
  const { client, transport } = makeClient();
  await client.connect();
  transport.sent.length = 0;
  await client.publish({ type: 'qu:Signal', durability: DURABILITY.EPHEMERAL, allowUnencryptedPrivate: true });
  const frames = transport.sent.filter(isDataFrame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, 'ephemeral');
});

test('session publish never queues either', async () => {
  const { client } = makeClient();
  await client.publish({ type: 'qu:Cursor', durability: DURABILITY.SESSION, sessionId: 's1', allowUnencryptedPrivate: true });
  assert.equal(await client.outboxSize(), 0);
});

test('a public publish (visibility includes the Public collection) does not require encryption', async () => {
  const { client } = makeClient();
  const doc = await client.publish({ type: 'Note', visibility: 'https://www.w3.org/ns/activitystreams#Public' });
  assert.equal(doc.type, 'Note');
});

test('a non-public publish without encryptFor or the opt-out throws', async () => {
  const { client } = makeClient();
  await assert.rejects(() => client.publish({ type: 'Note' }), /requires encryption/);
});

test('a non-public publish with visibility set (not Public) still requires encryption', async () => {
  const { client } = makeClient();
  await assert.rejects(
    () => client.publish({ type: 'Note', visibility: 'https://relay.example/followers' }),
    /requires encryption/,
  );
});

test('encryptFor produces an opaque encryptedPayload the recipient can decrypt', async () => {
  const { store, client } = makeClient();
  const senderX = generateX25519Keypair();
  const bobX = generateX25519Keypair();
  const senderKeypair = { privateKey: senderX.privateKey, publicKeyMultibase: encodeX25519Multikey(senderX.publicKeyRaw) };
  const bob = { id: 'https://relay.example/actors/bob', publicKeyMultibase: encodeX25519Multikey(bobX.publicKeyRaw) };

  const doc = await client.publish({
    id: 'https://relay.example/objects/secret-note',
    type: 'Note',
    fields: { content: 'only for bob' },
    visibility: bob.id,
    encryptFor: [bob],
    senderKeypair,
  });

  assert.equal(doc.encrypted, true);
  assert.equal('content' in doc, false); // plaintext never lands on the document
  assert.equal(JSON.stringify(doc).includes('only for bob'), false);
  assert.deepEqual(await store.get(doc.id), doc); // the stored copy is equally opaque

  const plaintext = JSON.parse(decryptPayload(doc.encryptedPayload, { recipientId: bob.id, recipientPrivateKey: bobX.privateKey }));
  assert.equal(plaintext.content, 'only for bob');
});

test('encryptFor without senderKeypair throws', async () => {
  const { client } = makeClient();
  await assert.rejects(
    () =>
      client.publish({
        type: 'Note',
        visibility: 'https://relay.example/actors/bob',
        encryptFor: [{ id: 'https://relay.example/actors/bob', publicKeyMultibase: 'z...' }],
      }),
    /senderKeypair/,
  );
});

test('claiming both Public visibility and encryptFor throws (contradiction)', async () => {
  const { client } = makeClient();
  await assert.rejects(() =>
    client.publish({
      type: 'Note',
      visibility: 'https://www.w3.org/ns/activitystreams#Public',
      encryptFor: [{ id: 'x', publicKeyMultibase: 'z...' }],
    }),
  );
});

test('receiving a data frame applies it to the local store', async () => {
  const { store, client, transport } = makeClient();
  const doc = { id: 'https://relay.example/objects/from-server', type: 'Note' };
  transport.receive({ kind: 'object', id: doc.id, doc, collections: [OUTBOX], durability: DURABILITY.PERSISTENT });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await store.get(doc.id), doc);
});

test('connect() sends hello, then subscribe for pre-existing subscriptions, then resume, in order', async () => {
  const { client, transport } = makeClient();
  client.subscribe(OUTBOX);
  await client.connect();

  const controlOps = transport.sent.filter(isControlFrame).map((f) => f.op);
  assert.deepEqual(controlOps, [CONTROL_OP.HELLO, CONTROL_OP.SUBSCRIBE, CONTROL_OP.RESUME]);
});

test('subscribe() while connected sends a live subscribe frame immediately', async () => {
  const { client, transport } = makeClient();
  await client.connect();
  transport.sent.length = 0;
  client.subscribe(OUTBOX);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].op, CONTROL_OP.SUBSCRIBE);
});

test('watchChildren subscribes, and its unwatch function unsubscribes', async () => {
  const { client, transport } = makeClient();
  await client.connect();
  transport.sent.length = 0;

  const unwatch = client.watchChildren(OUTBOX, () => {});
  assert.equal(transport.sent.filter((f) => f.op === CONTROL_OP.SUBSCRIBE).length, 1);

  unwatch();
  assert.equal(transport.sent.filter((f) => f.op === CONTROL_OP.UNSUBSCRIBE).length, 1);
});

test('watch() reflects live local-store changes (integration with @qu/reactive)', async () => {
  const { client } = makeClient();
  const calls = [];
  client.watch('https://relay.example/objects/x', (doc) => calls.push(doc));
  await new Promise((r) => setImmediate(r));

  await client.publish({ id: 'https://relay.example/objects/x', type: 'Note', allowUnencryptedPrivate: true });
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.length, 2);
  assert.equal(calls[0], null);
  assert.equal(calls[1].id, 'https://relay.example/objects/x');
});

test('a resumed control frame persists the cursor, used on the next resume', async () => {
  const { client, transport } = makeClient();
  client.subscribe(OUTBOX);
  await client.connect();

  transport.receive(buildControlFrame(CONTROL_OP.RESUMED, { cursors: { [OUTBOX]: '000000000001000 x' } }));
  await new Promise((r) => setImmediate(r));

  transport.sent.length = 0;
  await client.connect(); // simulate a reconnect
  const resumeFrame = transport.sent.find((f) => f.op === CONTROL_OP.RESUME);
  assert.equal(resumeFrame.since[OUTBOX], '000000000001000 x');
});

test('the cursor survives across a fresh ApClient instance sharing the same store (app restart)', async () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const transport1 = new FakeTransport();
  const client1 = new ApClient({ store, transport: transport1, actorId: ACTOR_ID });
  client1.subscribe(OUTBOX);
  await client1.connect();
  transport1.receive(buildControlFrame(CONTROL_OP.RESUMED, { cursors: { [OUTBOX]: '000000000002000 y' } }));
  await new Promise((r) => setImmediate(r));

  const transport2 = new FakeTransport();
  const client2 = new ApClient({ store, transport: transport2, actorId: ACTOR_ID });
  client2.subscribe(OUTBOX);
  await client2.connect();

  const resumeFrame = transport2.sent.find((f) => f.op === CONTROL_OP.RESUME);
  assert.equal(resumeFrame.since[OUTBOX], '000000000002000 y');
});

test('a mid-flush send failure leaves the remaining entries queued for next time', async () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const transport = new FakeTransport();
  let sendCount = 0;
  const realSend = transport.send.bind(transport);
  transport.send = (frame) => {
    sendCount += 1;
    // connect() itself sends 'hello' (1) then 'resume' (2) before the
    // outbox flush starts; allow those plus exactly one outbox entry (3)
    // through, then simulate the connection dropping mid-flush.
    if (sendCount > 3) throw new Error('connection dropped mid-flush');
    realSend(frame);
  };
  const client = new ApClient({ store, transport, actorId: ACTOR_ID });

  // Two entries queued while disconnected.
  await client.publish({ id: 'https://relay.example/objects/1', type: 'Note', collections: [OUTBOX], allowUnencryptedPrivate: true });
  await client.publish({ id: 'https://relay.example/objects/2', type: 'Note', collections: [OUTBOX], allowUnencryptedPrivate: true });
  assert.equal(await client.outboxSize(), 2);

  await client.connect();
  assert.equal(await client.outboxSize(), 1);
});
