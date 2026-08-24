import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequest, verifyRequest, extractKeyId } from '../src/http-signature.js';
import { generateRsaTransportKeypair } from '../src/multikey.js';

const KEY_ID = 'https://relay.example/actors/alice#transport-key';

test('signs a GET request and verifies successfully', () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const url = 'https://target.example/inbox';
  const headers = signRequest({ method: 'GET', url, keyId: KEY_ID, privateKey });

  assert.ok(headers.signature.includes(`keyId="${KEY_ID}"`));
  assert.ok(headers.date);
  assert.equal(headers.host, 'target.example');

  const ok = verifyRequest({ method: 'GET', url, headers, publicKey });
  assert.equal(ok, true);
});

test('signs a POST request with a body, including Digest', () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const url = 'https://target.example/inbox';
  const body = JSON.stringify({ type: 'Create' });
  const headers = signRequest({ method: 'POST', url, body, keyId: KEY_ID, privateKey });

  assert.ok(headers.digest.startsWith('SHA-256='));
  assert.equal(verifyRequest({ method: 'POST', url, headers, body, publicKey }), true);
});

test('rejects a tampered body against the Digest header', () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const url = 'https://target.example/inbox';
  const body = JSON.stringify({ type: 'Create' });
  const headers = signRequest({ method: 'POST', url, body, keyId: KEY_ID, privateKey });

  const ok = verifyRequest({ method: 'POST', url, headers, body: 'tampered body', publicKey });
  assert.equal(ok, false);
});

test('rejects a signature verified with the wrong public key', () => {
  const signer = generateRsaTransportKeypair();
  const other = generateRsaTransportKeypair();
  const url = 'https://target.example/inbox';
  const headers = signRequest({ method: 'GET', url, keyId: KEY_ID, privateKey: signer.privateKey });

  assert.equal(verifyRequest({ method: 'GET', url, headers, publicKey: other.publicKey }), false);
});

test('rejects a request whose target path was altered after signing', () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const url = 'https://target.example/inbox';
  const headers = signRequest({ method: 'GET', url, keyId: KEY_ID, privateKey });

  const tamperedUrl = 'https://target.example/other-inbox';
  assert.equal(verifyRequest({ method: 'GET', url: tamperedUrl, headers, publicKey }), false);
});

test('verifyRequest returns false when there is no Signature header', () => {
  const { publicKey } = generateRsaTransportKeypair();
  assert.equal(
    verifyRequest({ method: 'GET', url: 'https://target.example/inbox', headers: {}, publicKey }),
    false,
  );
});

test('extractKeyId reads keyId out of a signed request without verifying', () => {
  const { privateKey } = generateRsaTransportKeypair();
  const headers = signRequest({
    method: 'GET',
    url: 'https://target.example/inbox',
    keyId: KEY_ID,
    privateKey,
  });
  assert.equal(extractKeyId(headers.signature), KEY_ID);
});

test('extractKeyId returns null for missing/malformed input', () => {
  assert.equal(extractKeyId(undefined), null);
  assert.equal(extractKeyId('garbage'), null);
});

test('verifyRequest returns false for a malformed Signature header', () => {
  const { publicKey } = generateRsaTransportKeypair();
  const ok = verifyRequest({
    method: 'GET',
    url: 'https://target.example/inbox',
    headers: { signature: 'garbage' },
    publicKey,
  });
  assert.equal(ok, false);
});
