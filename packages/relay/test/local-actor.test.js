import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalVault, MemoryVaultAdapter } from '@qu/local-vault';
import { ensureLocalActor } from '../src/local-actor.js';

function makeVault() {
  return new LocalVault(new MemoryVaultAdapter());
}

test('requires vault, host and username', async () => {
  const vault = makeVault();
  await assert.rejects(() => ensureLocalActor({ host: 'relay.example', username: 'alice' }));
  await assert.rejects(() => ensureLocalActor({ vault, username: 'alice' }));
  await assert.rejects(() => ensureLocalActor({ vault, host: 'relay.example' }));
});

test('builds a well-formed actor document', async () => {
  const vault = makeVault();
  const record = await ensureLocalActor({ vault, host: 'relay.example', username: 'alice' });
  assert.equal(record.actor.id, 'https://relay.example/actors/alice');
  assert.equal(record.actor.inbox, 'https://relay.example/actors/alice/inbox');
  assert.equal(record.actor.endpoints.sharedInbox, 'https://relay.example/inbox');
  assert.equal(record.keyId, 'https://relay.example/actors/alice#transport-key');
  assert.equal(record.username, 'alice');
});

test('generates and persists a seed and transport keypair on first use', async () => {
  const vault = makeVault();
  assert.equal(await vault.getSeed(), null);
  await ensureLocalActor({ vault, host: 'relay.example', username: 'alice' });
  assert.notEqual(await vault.getSeed(), null);
  assert.notEqual(await vault.getTransportKeypair(), null);
});

test('is idempotent: reusing the same vault yields the same identity', async () => {
  const vault = makeVault();
  const first = await ensureLocalActor({ vault, host: 'relay.example', username: 'alice' });
  const second = await ensureLocalActor({ vault, host: 'relay.example', username: 'alice' });
  assert.equal(first.edKeypair.publicKeyMultibase, second.edKeypair.publicKeyMultibase);
  assert.deepEqual(first.actor, second.actor);
});

test('the private/public RSA KeyObjects actually match (usable for signing)', async () => {
  const vault = makeVault();
  const record = await ensureLocalActor({ vault, host: 'relay.example', username: 'alice' });
  assert.equal(record.privateKey.asymmetricKeyType, 'rsa');
  assert.equal(record.publicKey.asymmetricKeyType, 'rsa');
});
