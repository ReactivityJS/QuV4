import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsAdapter } from '../src/fs-adapter.js';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'qu-runtime-fs-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('requires a dir', () => {
  assert.throws(() => new FsAdapter());
});

test('get returns undefined for a missing key', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsAdapter(join(dir, 'store'));
    assert.equal(await adapter.get('missing'), undefined);
  });
});

test('put/get round-trips a JSON value', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsAdapter(join(dir, 'store'));
    await adapter.put('obj/https://relay.example/x', { id: 'x', type: 'Note' });
    assert.deepEqual(await adapter.get('obj/https://relay.example/x'), { id: 'x', type: 'Note' });
  });
});

test('delete removes a key', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsAdapter(join(dir, 'store'));
    await adapter.put('a', 1);
    await adapter.delete('a');
    assert.equal(await adapter.get('a'), undefined);
  });
});

test('list returns entries in ascending key order by default', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsAdapter(join(dir, 'store'));
    await adapter.put('b', 2);
    await adapter.put('a', 1);
    await adapter.put('c', 3);
    const entries = await adapter.list();
    assert.deepEqual(entries.map((e) => e.key), ['a', 'b', 'c']);
    assert.deepEqual(entries.map((e) => e.value), [1, 2, 3]);
  });
});

test('list supports reverse order and limit', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsAdapter(join(dir, 'store'));
    await adapter.put('a', 1);
    await adapter.put('b', 2);
    await adapter.put('c', 3);
    const entries = await adapter.list({ reverse: true, limit: 2 });
    assert.deepEqual(entries.map((e) => e.key), ['c', 'b']);
  });
});

test('list filters by prefix, with keys containing slashes and colons', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsAdapter(join(dir, 'store'));
    await adapter.put('idx/https://relay.example/outbox/1', 'a');
    await adapter.put('idx/https://relay.example/outbox/2', 'b');
    await adapter.put('idx/https://relay.example/inbox/1', 'c');
    const entries = await adapter.list({ prefix: 'idx/https://relay.example/outbox/' });
    assert.equal(entries.length, 2);
  });
});

test('persists across separate adapter instances against the same dir', async () => {
  await withTempDir(async (dir) => {
    const storeDir = join(dir, 'store');
    await new FsAdapter(storeDir).put('a', { persisted: true });
    const reopened = new FsAdapter(storeDir);
    assert.deepEqual(await reopened.get('a'), { persisted: true });
  });
});
