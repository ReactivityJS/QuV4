import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateX25519Keypair } from '@qu/core';
import { encodeX25519Multikey } from '../src/x25519-multikey.js';
import { encryptPayload, decryptPayload } from '../src/payload.js';

function actorKeys() {
  const kp = generateX25519Keypair();
  return { ...kp, publicKeyMultibase: encodeX25519Multikey(kp.publicKeyRaw) };
}

test('encryptPayload produces a self-contained qu:EncryptedPayload document', () => {
  const sender = actorKeys();
  const bob = actorKeys();
  const payload = encryptPayload('secret setting', {
    senderPrivateKey: sender.privateKey,
    senderPublicKeyMultibase: sender.publicKeyMultibase,
    recipients: [{ id: 'https://relay.example/actors/bob', publicKeyMultibase: bob.publicKeyMultibase }],
  });
  assert.equal(payload.type, 'qu:EncryptedPayload');
  assert.equal(payload.senderKey, sender.publicKeyMultibase);
  assert.equal(typeof payload.iv, 'string');
  assert.equal(typeof payload.ciphertext, 'string');
  assert.equal(payload.to.length, 1);
  assert.equal(payload.to[0].id, 'https://relay.example/actors/bob');
});

test('the payload never contains the plaintext anywhere', () => {
  const sender = actorKeys();
  const bob = actorKeys();
  const payload = encryptPayload('super secret theme preference', {
    senderPrivateKey: sender.privateKey,
    senderPublicKeyMultibase: sender.publicKeyMultibase,
    recipients: [{ id: 'https://relay.example/actors/bob', publicKeyMultibase: bob.publicKeyMultibase }],
  });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('super secret theme preference'), false);
});

test('decryptPayload round-trips for the intended recipient', () => {
  const sender = actorKeys();
  const bob = actorKeys();
  const payload = encryptPayload('theme=dark', {
    senderPrivateKey: sender.privateKey,
    senderPublicKeyMultibase: sender.publicKeyMultibase,
    recipients: [{ id: 'https://relay.example/actors/bob', publicKeyMultibase: bob.publicKeyMultibase }],
  });
  const plaintext = decryptPayload(payload, {
    recipientId: 'https://relay.example/actors/bob',
    recipientPrivateKey: bob.privateKey,
  });
  assert.equal(plaintext, 'theme=dark');
});

test('a payload can be JSON round-tripped (serialize, parse, still decryptable)', () => {
  const sender = actorKeys();
  const bob = actorKeys();
  const payload = encryptPayload('theme=dark', {
    senderPrivateKey: sender.privateKey,
    senderPublicKeyMultibase: sender.publicKeyMultibase,
    recipients: [{ id: 'https://relay.example/actors/bob', publicKeyMultibase: bob.publicKeyMultibase }],
  });
  const roundTripped = JSON.parse(JSON.stringify(payload));
  const plaintext = decryptPayload(roundTripped, {
    recipientId: 'https://relay.example/actors/bob',
    recipientPrivateKey: bob.privateKey,
  });
  assert.equal(plaintext, 'theme=dark');
});

test('a non-recipient cannot decrypt', () => {
  const sender = actorKeys();
  const bob = actorKeys();
  const eve = actorKeys();
  const payload = encryptPayload('theme=dark', {
    senderPrivateKey: sender.privateKey,
    senderPublicKeyMultibase: sender.publicKeyMultibase,
    recipients: [{ id: 'https://relay.example/actors/bob', publicKeyMultibase: bob.publicKeyMultibase }],
  });
  assert.throws(() =>
    decryptPayload(payload, { recipientId: 'https://relay.example/actors/eve', recipientPrivateKey: eve.privateKey }),
  );
});

test('multiple recipients each decrypt independently', () => {
  const sender = actorKeys();
  const bob = actorKeys();
  const carol = actorKeys();
  const payload = encryptPayload('group theme', {
    senderPrivateKey: sender.privateKey,
    senderPublicKeyMultibase: sender.publicKeyMultibase,
    recipients: [
      { id: 'bob', publicKeyMultibase: bob.publicKeyMultibase },
      { id: 'carol', publicKeyMultibase: carol.publicKeyMultibase },
    ],
  });
  assert.equal(decryptPayload(payload, { recipientId: 'bob', recipientPrivateKey: bob.privateKey }), 'group theme');
  assert.equal(decryptPayload(payload, { recipientId: 'carol', recipientPrivateKey: carol.privateKey }), 'group theme');
});
