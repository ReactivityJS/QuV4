import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode, base58Decode } from '../src/base58.js';

test('round-trips arbitrary bytes', () => {
  const bytes = Buffer.from('the quick brown fox', 'utf8');
  assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
});

test('preserves leading zero bytes as leading 1s', () => {
  const bytes = Buffer.from([0, 0, 1, 2, 3]);
  const encoded = base58Encode(bytes);
  assert.ok(encoded.startsWith('11'));
  assert.deepEqual(base58Decode(encoded), bytes);
});

test('empty input round-trips to empty', () => {
  assert.equal(base58Encode(Buffer.alloc(0)), '');
  assert.deepEqual(base58Decode(''), Buffer.alloc(0));
});

test('rejects invalid characters on decode', () => {
  assert.throws(() => base58Decode('0OIl'));
});

test('matches a known Bitcoin base58 test vector', () => {
  // "Hello World" -> well-known base58 vector
  assert.equal(base58Encode(Buffer.from('Hello World')), 'JxF12TrwUP45BMd');
});
