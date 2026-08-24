import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  generateEd25519Keypair,
  ed25519KeypairFromSeed,
  ed25519Sign,
  ed25519Verify,
  encodeEd25519Multikey,
  decodeEd25519Multikey,
  generateRsaTransportKeypair,
} from '../src/multikey.js';

test('generateEd25519Keypair produces a did:key-shaped multibase string', () => {
  const kp = generateEd25519Keypair();
  assert.match(kp.publicKeyMultibase, /^z6Mk[1-9A-HJ-NP-Za-km-z]+$/);
});

test('encode/decode multikey round-trips raw public key bytes', () => {
  const kp = generateEd25519Keypair();
  const decoded = decodeEd25519Multikey(kp.publicKeyMultibase);
  assert.deepEqual(decoded, kp.publicKeyRaw);
  assert.deepEqual(decodeEd25519Multikey(encodeEd25519Multikey(kp.publicKeyRaw)), kp.publicKeyRaw);
});

test('decodeEd25519Multikey rejects non-multibase input', () => {
  assert.throws(() => decodeEd25519Multikey('not-multibase'));
});

test('sign/verify round-trip with KeyObjects', () => {
  const kp = generateEd25519Keypair();
  const sig = ed25519Sign(kp.privateKey, 'hello world');
  assert.equal(ed25519Verify(kp.publicKey, 'hello world', sig), true);
  assert.equal(ed25519Verify(kp.publicKey, 'tampered', sig), false);
});

test('verify accepts a multibase string in place of a KeyObject', () => {
  const kp = generateEd25519Keypair();
  const sig = ed25519Sign(kp.privateKey, 'hello world');
  assert.equal(ed25519Verify(kp.publicKeyMultibase, 'hello world', sig), true);
});

test('ed25519KeypairFromSeed is deterministic', () => {
  const seed = randomBytes(32);
  const a = ed25519KeypairFromSeed(seed);
  const b = ed25519KeypairFromSeed(seed);
  assert.equal(a.publicKeyMultibase, b.publicKeyMultibase);
  assert.deepEqual(a.privateKeyRaw, b.privateKeyRaw);
});

test('ed25519KeypairFromSeed rejects a wrong-length seed', () => {
  assert.throws(() => ed25519KeypairFromSeed(Buffer.alloc(16)));
});

test('different seeds produce different keys', () => {
  const a = ed25519KeypairFromSeed(randomBytes(32));
  const b = ed25519KeypairFromSeed(randomBytes(32));
  assert.notEqual(a.publicKeyMultibase, b.publicKeyMultibase);
});

test('generateRsaTransportKeypair produces usable PEM keys', () => {
  const kp = generateRsaTransportKeypair();
  assert.match(kp.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.match(kp.privateKeyPem, /BEGIN PRIVATE KEY/);
});
