import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalizeToBytes } from '../src/canonicalize.js';

test('sorts object keys by UTF-16 code unit', () => {
  const a = canonicalize({ b: 1, a: 2, c: 3 });
  assert.equal(a, '{"a":2,"b":1,"c":3}');
});

test('is independent of source key order', () => {
  const x = canonicalize({ id: '1', type: 'Note', to: ['x'] });
  const y = canonicalize({ to: ['x'], type: 'Note', id: '1' });
  assert.equal(x, y);
});

test('nested objects and arrays are canonicalized recursively', () => {
  const out = canonicalize({ z: [{ b: 1, a: 2 }, 'x'], a: 1 });
  assert.equal(out, '{"a":1,"z":[{"a":2,"b":1},"x"]}');
});

test('negative zero serializes as 0', () => {
  assert.equal(canonicalize(-0), '0');
});

test('strings are escaped the same way as JSON.stringify', () => {
  assert.equal(canonicalize('a"b\\c\nd'), JSON.stringify('a"b\\c\nd'));
});

test('rejects non-finite numbers', () => {
  assert.throws(() => canonicalize({ a: NaN }), TypeError);
  assert.throws(() => canonicalize({ a: Infinity }), TypeError);
});

test('omits undefined object values, nulls undefined array entries', () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalize([1, undefined, 3]), '[1,null,3]');
});

test('canonicalizeToBytes returns UTF-8 bytes of the canonical form', () => {
  const bytes = canonicalizeToBytes({ a: 'é' });
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.toString('utf8'), '{"a":"é"}');
});

test('two structurally-equal documents with different key order canonicalize identically', () => {
  const doc1 = { type: 'Create', actor: 'https://a', object: { type: 'Note', content: 'hi' } };
  const doc2 = { object: { content: 'hi', type: 'Note' }, actor: 'https://a', type: 'Create' };
  assert.equal(canonicalize(doc1), canonicalize(doc2));
});
