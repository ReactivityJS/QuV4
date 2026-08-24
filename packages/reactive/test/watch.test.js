import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { watch } from '../src/watch.js';

async function flush() {
  await sleep(0);
}

function makeStore() {
  return new ApStore({ adapter: new MemoryStoreAdapter() });
}

test('watch requires a non-empty id and a callback function', () => {
  const store = makeStore();
  assert.throws(() => watch(store, '', () => {}), TypeError);
  assert.throws(() => watch(store, 'x', 'not a function'), TypeError);
});

test('watch fires immediately with the current doc (or null if absent)', async () => {
  const store = makeStore();
  const calls = [];
  watch(store, 'https://relay.example/x', (doc) => calls.push(doc));
  await flush();
  assert.deepEqual(calls, [null]);
});

test('watch fires again after the watched doc changes, always re-read from the store', async () => {
  const store = makeStore();
  const id = 'https://relay.example/notes/1';
  const calls = [];
  watch(store, id, (doc) => calls.push(doc));
  await flush();

  const doc = { id, type: 'Note', content: 'hi' };
  await store.put(doc);
  await flush();

  assert.deepEqual(calls, [null, doc]);
});

test('watch fires with null after the watched doc is deleted', async () => {
  const store = makeStore();
  const id = 'https://relay.example/notes/1';
  await store.put({ id, type: 'Note' });

  const calls = [];
  watch(store, id, (doc) => calls.push(doc));
  await flush();

  await store.delete(id);
  await flush();

  assert.deepEqual(calls, [{ id, type: 'Note' }, null]);
});

test('watch ignores changes to a different id', async () => {
  const store = makeStore();
  const calls = [];
  watch(store, 'https://relay.example/a', (doc) => calls.push(doc));
  await flush();

  await store.put({ id: 'https://relay.example/b', type: 'Note' });
  await flush();

  assert.deepEqual(calls, [null]);
});

test('unsubscribe stops further notifications', async () => {
  const store = makeStore();
  const id = 'https://relay.example/notes/1';
  const calls = [];
  const unsubscribe = watch(store, id, (doc) => calls.push(doc));
  await flush();

  unsubscribe();
  await store.put({ id, type: 'Note' });
  await flush();

  assert.deepEqual(calls, [null]);
});

test('a slow-resolving change never clobbers a later, faster one (stale reads are dropped)', async () => {
  // A store whose get() resolves out of order relative to when it was
  // called, simulating a slow Fs read racing a fast in-memory one.
  let resolveSlow;
  let getCallCount = 0;
  const fakeStore = {
    listeners: [],
    onChange(fn) {
      this.listeners.push(fn);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== fn);
      };
    },
    get() {
      getCallCount += 1;
      if (getCallCount === 1) return Promise.resolve('initial');
      if (getCallCount === 2) return new Promise((resolve) => { resolveSlow = resolve; });
      return Promise.resolve('fast-update');
    },
    emit() {
      for (const fn of this.listeners) fn({ id: 'x' });
    },
  };

  const calls = [];
  watch(fakeStore, 'x', (doc) => calls.push(doc));
  await flush();
  assert.deepEqual(calls, ['initial']);

  fakeStore.emit(); // triggers the slow read (call #2), left pending
  fakeStore.emit(); // triggers the fast read (call #3), resolves immediately
  await flush();
  assert.deepEqual(calls, ['initial', 'fast-update']);

  resolveSlow('stale'); // the slow read finally resolves — must be ignored
  await flush();
  assert.deepEqual(calls, ['initial', 'fast-update']);
});
