import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStoreAdapter } from '../src/adapters/memory-adapter.js';

test('get returns undefined for a missing key', async () => {
  const adapter = new MemoryStoreAdapter();
  assert.equal(await adapter.get('missing'), undefined);
});

test('put/get round-trips a value', async () => {
  const adapter = new MemoryStoreAdapter();
  await adapter.put('a', { x: 1 });
  assert.deepEqual(await adapter.get('a'), { x: 1 });
});

test('delete removes a key', async () => {
  const adapter = new MemoryStoreAdapter();
  await adapter.put('a', 1);
  await adapter.delete('a');
  assert.equal(await adapter.get('a'), undefined);
});

test('list returns entries in ascending key order by default', async () => {
  const adapter = new MemoryStoreAdapter();
  await adapter.put('b', 2);
  await adapter.put('a', 1);
  await adapter.put('c', 3);
  const entries = await adapter.list();
  assert.deepEqual(entries.map((e) => e.key), ['a', 'b', 'c']);
});

test('list supports reverse order', async () => {
  const adapter = new MemoryStoreAdapter();
  await adapter.put('a', 1);
  await adapter.put('b', 2);
  const entries = await adapter.list({ reverse: true });
  assert.deepEqual(entries.map((e) => e.key), ['b', 'a']);
});

test('list filters by prefix', async () => {
  const adapter = new MemoryStoreAdapter();
  await adapter.put('idx/x/1', 1);
  await adapter.put('idx/y/1', 2);
  await adapter.put('obj/z', 3);
  const entries = await adapter.list({ prefix: 'idx/x/' });
  assert.deepEqual(entries.map((e) => e.key), ['idx/x/1']);
});

test('list respects limit', async () => {
  const adapter = new MemoryStoreAdapter();
  await adapter.put('a', 1);
  await adapter.put('b', 2);
  await adapter.put('c', 3);
  const entries = await adapter.list({ limit: 2 });
  assert.equal(entries.length, 2);
});
