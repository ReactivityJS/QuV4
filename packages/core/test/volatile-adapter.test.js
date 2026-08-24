import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { VolatileAdapter } from '../src/adapters/volatile-adapter.js';

test('put/get round-trips a value before expiry', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 5000 });
  await adapter.put('a', { x: 1 });
  assert.deepEqual(await adapter.get('a'), { x: 1 });
});

test('entries expire after their ttl', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 20 });
  await adapter.put('a', 1);
  assert.equal(await adapter.get('a'), 1);
  await sleep(60);
  assert.equal(await adapter.get('a'), undefined);
});

test('per-put ttl overrides the adapter default', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 5000 });
  await adapter.put('a', 1, { ttlMs: 20 });
  await sleep(60);
  assert.equal(await adapter.get('a'), undefined);
});

test('has() reflects expiry', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 20 });
  await adapter.put('a', 1);
  assert.equal(await adapter.has('a'), true);
  await sleep(60);
  assert.equal(await adapter.has('a'), false);
});

test('delete removes an entry immediately', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 5000 });
  await adapter.put('a', 1);
  await adapter.delete('a');
  assert.equal(await adapter.get('a'), undefined);
});

test('list filters by prefix and excludes expired entries', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 5000 });
  await adapter.put('session/s1/a', 1);
  await adapter.put('session/s1/b', 2);
  await adapter.put('session/s2/a', 3, { ttlMs: 20 });
  await sleep(60);
  const entries = await adapter.list({ prefix: 'session/s1/' });
  assert.deepEqual(entries.map((e) => e.key).sort(), ['session/s1/a', 'session/s1/b']);
});

test('clear(prefix) wipes an entire session at once', async () => {
  const adapter = new VolatileAdapter({ ttlMs: 5000 });
  await adapter.put('session/s1/a', 1);
  await adapter.put('session/s1/b', 2);
  await adapter.put('session/s2/a', 3);
  adapter.clear('session/s1/');
  assert.equal(await adapter.get('session/s1/a'), undefined);
  assert.equal(await adapter.get('session/s2/a'), 3);
});
