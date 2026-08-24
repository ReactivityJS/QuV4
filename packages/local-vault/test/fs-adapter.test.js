import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsVaultAdapter } from '../src/adapters/fs-adapter.js';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'qu-local-vault-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('requires a dir', () => {
  assert.throws(() => new FsVaultAdapter());
});

test('get returns undefined for a missing key', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsVaultAdapter(join(dir, 'vault'));
    assert.equal(await adapter.get('missing'), undefined);
  });
});

test('set/get round-trips JSON values', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsVaultAdapter(join(dir, 'vault'));
    await adapter.set('a', { publicKeyPem: 'PEM' });
    assert.deepEqual(await adapter.get('a'), { publicKeyPem: 'PEM' });
  });
});

test('set/get round-trips Buffer values', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsVaultAdapter(join(dir, 'vault'));
    const seed = Buffer.from('super secret seed bytes');
    await adapter.set('seed', seed);
    const got = await adapter.get('seed');
    assert.ok(Buffer.isBuffer(got));
    assert.deepEqual(got, seed);
  });
});

test('delete removes the underlying file', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsVaultAdapter(join(dir, 'vault'));
    await adapter.set('a', 1);
    await adapter.delete('a');
    assert.equal(await adapter.get('a'), undefined);
  });
});

test('creates the vault directory with restrictive permissions', async () => {
  await withTempDir(async (dir) => {
    const vaultDir = join(dir, 'vault');
    const adapter = new FsVaultAdapter(vaultDir);
    await adapter.set('a', 1);
    const info = await stat(vaultDir);
    assert.equal(info.mode & 0o777, 0o700);
  });
});

test('keys lists stored keys, including ones with unsafe characters', async () => {
  await withTempDir(async (dir) => {
    const adapter = new FsVaultAdapter(join(dir, 'vault'));
    await adapter.set('identity-seed', 1);
    await adapter.set('transport-keypair', 2);
    assert.deepEqual(new Set(await adapter.keys()), new Set(['identity-seed', 'transport-keypair']));
  });
});
