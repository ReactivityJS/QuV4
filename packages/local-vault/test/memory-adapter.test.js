import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVaultAdapter } from '../src/adapters/memory-adapter.js';

test('get returns undefined for a missing key', async () => {
  const adapter = new MemoryVaultAdapter();
  assert.equal(await adapter.get('missing'), undefined);
});

test('set then get round-trips a value', async () => {
  const adapter = new MemoryVaultAdapter();
  await adapter.set('a', { x: 1 });
  assert.deepEqual(await adapter.get('a'), { x: 1 });
});

test('delete removes a key', async () => {
  const adapter = new MemoryVaultAdapter();
  await adapter.set('a', 1);
  await adapter.delete('a');
  assert.equal(await adapter.get('a'), undefined);
});

test('keys lists all stored keys', async () => {
  const adapter = new MemoryVaultAdapter();
  await adapter.set('a', 1);
  await adapter.set('b', 2);
  assert.deepEqual(new Set(await adapter.keys()), new Set(['a', 'b']));
});
