import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateX25519Keypair } from '@qu/core';
import { encodeX25519Multikey, decodeX25519Multikey } from '../src/x25519-multikey.js';

test('encode/decode round-trips raw key bytes', () => {
  const kp = generateX25519Keypair();
  const encoded = encodeX25519Multikey(kp.publicKeyRaw);
  assert.equal(typeof encoded, 'string');
  assert.ok(encoded.startsWith('z'));
  assert.deepEqual(decodeX25519Multikey(encoded), kp.publicKeyRaw);
});

test('rejects a non-multibase string', () => {
  assert.throws(() => decodeX25519Multikey('not-multibase'));
});

test('rejects the wrong length of raw key bytes on encode', () => {
  assert.throws(() => encodeX25519Multikey(Buffer.alloc(16)));
});

test('an Ed25519 multikey is rejected as an X25519 key (different multicodec)', async () => {
  const { generateEd25519Keypair } = await import('@qu/ap-core');
  const ed = generateEd25519Keypair();
  assert.throws(() => decodeX25519Multikey(ed.publicKeyMultibase));
});
