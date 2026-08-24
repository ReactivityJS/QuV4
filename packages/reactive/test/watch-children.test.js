import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { watchChildren } from '../src/watch.js';

async function flush() {
  await sleep(0);
}

function makeStore() {
  return new ApStore({ adapter: new MemoryStoreAdapter() });
}

test('watchChildren requires a non-empty collectionId and a callback function', () => {
  const store = makeStore();
  assert.throws(() => watchChildren(store, '', () => {}), TypeError);
  assert.throws(() => watchChildren(store, 'x', 'not a function'), TypeError);
});

test('watchChildren fires immediately with the current (empty) list', async () => {
  const store = makeStore();
  const calls = [];
  watchChildren(store, 'https://relay.example/actors/alice/outbox', (docs) => calls.push(docs));
  await flush();
  assert.deepEqual(calls, [[]]);
});

test('watchChildren fires again when a member is added, newest first', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const calls = [];
  watchChildren(store, outbox, (docs) => calls.push(docs.map((d) => d.id)));
  await flush();

  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox], ts: 1 });
  await flush();
  await store.put({ id: 'https://relay.example/2' }, { collections: [outbox], ts: 2 });
  await flush();

  assert.deepEqual(calls, [
    [],
    ['https://relay.example/1'],
    ['https://relay.example/2', 'https://relay.example/1'],
  ]);
});

test('watchChildren ignores puts addressed to a different collection', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const other = 'https://relay.example/actors/bob/outbox';
  const calls = [];
  watchChildren(store, outbox, (docs) => calls.push(docs.length));
  await flush();

  await store.put({ id: 'https://relay.example/1' }, { collections: [other] });
  await flush();

  assert.deepEqual(calls, [0]);
});

test('unsubscribe stops further notifications', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const calls = [];
  const unsubscribe = watchChildren(store, outbox, (docs) => calls.push(docs.length));
  await flush();

  unsubscribe();
  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox] });
  await flush();

  assert.deepEqual(calls, [0]);
});

test('watchChildren forwards options like limit to getChildren', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  for (let i = 0; i < 3; i += 1) {
    await store.put({ id: `https://relay.example/${i}` }, { collections: [outbox], ts: i });
  }

  const calls = [];
  watchChildren(store, outbox, (docs) => calls.push(docs.length), { limit: 2 });
  await flush();

  assert.deepEqual(calls, [2]);
});
