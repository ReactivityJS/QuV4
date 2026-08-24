import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalVault } from '../src/vault.js';
import { MemoryVaultAdapter } from '../src/adapters/memory-adapter.js';

test('requires an adapter', () => {
  assert.throws(() => new LocalVault());
});

test('getSeed returns null before anything is stored', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  assert.equal(await vault.getSeed(), null);
});

test('setSeed/getSeed round-trips a Buffer', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  const seed = Buffer.from('a'.repeat(32));
  await vault.setSeed(seed);
  assert.deepEqual(await vault.getSeed(), seed);
});

test('setSeed rejects non-Buffer input', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  await assert.rejects(() => vault.setSeed('not a buffer'), TypeError);
});

test('getTransportKeypair returns null before anything is stored', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  assert.equal(await vault.getTransportKeypair(), null);
});

test('setTransportKeypair/getTransportKeypair round-trips PEM strings', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  await vault.setTransportKeypair({ publicKeyPem: 'PUB', privateKeyPem: 'PRIV' });
  assert.deepEqual(await vault.getTransportKeypair(), { publicKeyPem: 'PUB', privateKeyPem: 'PRIV' });
});

test('setTransportKeypair requires both keys', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  await assert.rejects(() => vault.setTransportKeypair({ publicKeyPem: 'PUB' }));
  await assert.rejects(() => vault.setTransportKeypair({ privateKeyPem: 'PRIV' }));
});

test('clear wipes both the seed and the transport keypair', async () => {
  const vault = new LocalVault(new MemoryVaultAdapter());
  await vault.setSeed(Buffer.from('seed'));
  await vault.setTransportKeypair({ publicKeyPem: 'PUB', privateKeyPem: 'PRIV' });
  await vault.clear();
  assert.equal(await vault.getSeed(), null);
  assert.equal(await vault.getTransportKeypair(), null);
});

test('works end-to-end against the Fs-backed adapter shape too (duck-typed)', async () => {
  // A minimal duck-typed adapter proves LocalVault only relies on get/set/delete.
  const store = new Map();
  const adapter = {
    async get(key) { return store.has(key) ? store.get(key) : undefined; },
    async set(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
  const vault = new LocalVault(adapter);
  await vault.setSeed(Buffer.from('x'));
  assert.deepEqual(await vault.getSeed(), Buffer.from('x'));
});
