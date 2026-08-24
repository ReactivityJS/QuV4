import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter, VolatileAdapter } from '@qu/core';
import { DURABILITY } from '@qu/as2';
import { ApStore } from '../src/store.js';

function makeStore() {
  return new ApStore({ adapter: new MemoryStoreAdapter() });
}

test('put requires doc.id', async () => {
  const store = makeStore();
  await assert.rejects(() => store.put({}));
  await assert.rejects(() => store.put(null));
});

test('put rejects an unknown durability tier', async () => {
  const store = makeStore();
  await assert.rejects(() => store.put({ id: 'a' }, { durability: 'whenever' }));
});

test('get returns null for an unknown id', async () => {
  const store = makeStore();
  assert.equal(await store.get('https://relay.example/x'), null);
});

test('put/get round-trips a persistent doc', async () => {
  const store = makeStore();
  const doc = { id: 'https://relay.example/notes/1', type: 'Note', content: 'hi' };
  await store.put(doc);
  assert.deepEqual(await store.get(doc.id), doc);
});

test('put defaults to persistent durability', async () => {
  const store = makeStore();
  const doc = { id: 'https://relay.example/notes/1' };
  await store.put(doc);
  assert.deepEqual(await store.get(doc.id), doc);
});

test('delete removes a persisted doc', async () => {
  const store = makeStore();
  const doc = { id: 'https://relay.example/notes/1' };
  await store.put(doc);
  await store.delete(doc.id);
  assert.equal(await store.get(doc.id), null);
});

test('delete on an unknown id is a no-op', async () => {
  const store = makeStore();
  await assert.doesNotReject(() => store.delete('https://relay.example/nope'));
});

test('getChildren lists collection members newest-first', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox], ts: 1000 });
  await store.put({ id: 'https://relay.example/2' }, { collections: [outbox], ts: 2000 });
  await store.put({ id: 'https://relay.example/3' }, { collections: [outbox], ts: 3000 });

  const children = await store.getChildren(outbox);
  assert.deepEqual(
    children.map((d) => d.id),
    ['https://relay.example/3', 'https://relay.example/2', 'https://relay.example/1'],
  );
});

test('getChildren respects limit', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  for (let i = 0; i < 5; i += 1) {
    await store.put({ id: `https://relay.example/${i}` }, { collections: [outbox], ts: i });
  }
  const children = await store.getChildren(outbox, { limit: 2 });
  assert.equal(children.length, 2);
  assert.deepEqual(
    children.map((d) => d.id),
    ['https://relay.example/4', 'https://relay.example/3'],
  );
});

test('getChildren does not collide between collections whose ids share a prefix', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const outbox2 = 'https://relay.example/actors/alice/outbox2';
  await store.put({ id: 'https://relay.example/a' }, { collections: [outbox], ts: 1 });
  await store.put({ id: 'https://relay.example/b' }, { collections: [outbox2], ts: 2 });

  assert.deepEqual(
    (await store.getChildren(outbox)).map((d) => d.id),
    ['https://relay.example/a'],
  );
  assert.deepEqual(
    (await store.getChildren(outbox2)).map((d) => d.id),
    ['https://relay.example/b'],
  );
});

test('a doc can be indexed under multiple collections at once', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const inbox = 'https://relay.example/actors/bob/inbox';
  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox, inbox], ts: 1 });

  assert.equal((await store.getChildren(outbox)).length, 1);
  assert.equal((await store.getChildren(inbox)).length, 1);
});

test('delete removes a doc from every collection it was indexed under', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const doc = { id: 'https://relay.example/1' };
  await store.put(doc, { collections: [outbox], ts: 1 });
  await store.delete(doc.id);
  assert.deepEqual(await store.getChildren(outbox), []);
});

test('re-putting the same id under the same collection replaces, not duplicates, its index entry', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const doc = { id: 'https://relay.example/1', attempts: 0 };
  await store.put(doc, { collections: [outbox], ts: 1000 });
  await store.put({ ...doc, attempts: 1 }, { collections: [outbox], ts: 2000 });

  const children = await store.getChildren(outbox);
  assert.equal(children.length, 1);
  assert.equal(children[0].attempts, 1);
});

test('re-putting with a different collection set moves the id, not adds to it', async () => {
  const store = makeStore();
  const a = 'https://relay.example/collections/a';
  const b = 'https://relay.example/collections/b';
  const doc = { id: 'https://relay.example/1' };
  await store.put(doc, { collections: [a], ts: 1000 });
  await store.put(doc, { collections: [b], ts: 2000 });

  assert.deepEqual(await store.getChildren(a), []);
  assert.equal((await store.getChildren(b)).length, 1);
});

test('onChange fires on put with the doc and durability', async () => {
  const store = makeStore();
  const events = [];
  store.onChange((event) => events.push(event));
  const doc = { id: 'https://relay.example/1' };
  await store.put(doc, { collections: ['https://relay.example/outbox'] });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, doc.id);
  assert.deepEqual(events[0].doc, doc);
  assert.equal(events[0].durability, DURABILITY.PERSISTENT);
  assert.deepEqual(events[0].collections, ['https://relay.example/outbox']);
});

test('onChange fires on delete with doc: null', async () => {
  const store = makeStore();
  const doc = { id: 'https://relay.example/1' };
  await store.put(doc);
  const events = [];
  store.onChange((event) => events.push(event));
  await store.delete(doc.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].doc, null);
});

test('onChange returns an unsubscribe function', async () => {
  const store = makeStore();
  const events = [];
  const unsubscribe = store.onChange((event) => events.push(event));
  unsubscribe();
  await store.put({ id: 'https://relay.example/1' });
  assert.equal(events.length, 0);
});

test('ephemeral durability never persists and is not returned by get()', async () => {
  const store = makeStore();
  const doc = { id: 'https://relay.example/signal/1', type: 'qu:Signal' };
  await store.put(doc, { durability: DURABILITY.EPHEMERAL });
  assert.equal(await store.get(doc.id), null);
});

test('ephemeral durability emits a change event on first delivery only (dedup window)', async () => {
  const store = makeStore();
  const events = [];
  store.onChange((event) => events.push(event));
  const doc = { id: 'https://relay.example/signal/1' };
  await store.put(doc, { durability: DURABILITY.EPHEMERAL });
  await store.put(doc, { durability: DURABILITY.EPHEMERAL });
  await store.put(doc, { durability: DURABILITY.EPHEMERAL });
  assert.equal(events.length, 1);
});

test('ephemeral dedup window expires, allowing a later re-delivery to emit again', async () => {
  const store = new ApStore({
    adapter: new MemoryStoreAdapter(),
    dedup: new VolatileAdapter({ ttlMs: 20 }),
  });
  const events = [];
  store.onChange((event) => events.push(event));
  const doc = { id: 'https://relay.example/signal/1' };
  await store.put(doc, { durability: DURABILITY.EPHEMERAL });
  await sleep(60);
  await store.put(doc, { durability: DURABILITY.EPHEMERAL });
  assert.equal(events.length, 2);
});

test('session durability requires a sessionId', async () => {
  const store = makeStore();
  await assert.rejects(() => store.put({ id: 'x' }, { durability: DURABILITY.SESSION }));
});

test('session durability is not persisted and not visible via get()', async () => {
  const store = makeStore();
  const doc = { id: 'https://relay.example/cursor/1' };
  await store.put(doc, { durability: DURABILITY.SESSION, sessionId: 's1' });
  assert.equal(await store.get(doc.id), null);
});

test('session durability is visible via getSessionChildren, scoped by session', async () => {
  const store = makeStore();
  const collection = 'https://relay.example/collab/doc-1/cursors';
  await store.put({ id: 'https://relay.example/c1' }, {
    durability: DURABILITY.SESSION,
    sessionId: 's1',
    collections: [collection],
    ts: 1,
  });
  await store.put({ id: 'https://relay.example/c2' }, {
    durability: DURABILITY.SESSION,
    sessionId: 's2',
    collections: [collection],
    ts: 2,
  });

  const s1Children = await store.getSessionChildren('s1', collection);
  assert.deepEqual(s1Children.map((d) => d.id), ['https://relay.example/c1']);

  const s2Children = await store.getSessionChildren('s2', collection);
  assert.deepEqual(s2Children.map((d) => d.id), ['https://relay.example/c2']);
});

test('endSession wipes every entry for that session', async () => {
  const store = makeStore();
  const collection = 'https://relay.example/collab/doc-1/cursors';
  const doc = { id: 'https://relay.example/c1' };
  await store.put(doc, { durability: DURABILITY.SESSION, sessionId: 's1', collections: [collection] });
  store.endSession('s1');
  assert.deepEqual(await store.getSessionChildren('s1', collection), []);
});
