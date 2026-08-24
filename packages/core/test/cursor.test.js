import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, compareCursors } from '../src/adapters/cursor.js';

test('encodeCursor/decodeCursor round-trip', () => {
  const cursor = encodeCursor({ ts: 1700000000000, id: 'https://relay.example/x' });
  assert.deepEqual(decodeCursor(cursor), { ts: 1700000000000, id: 'https://relay.example/x' });
});

test('encoded cursors sort lexicographically in timestamp order', () => {
  const early = encodeCursor({ ts: 1000, id: 'b' });
  const late = encodeCursor({ ts: 2000, id: 'a' });
  assert.ok(early < late);
});

test('same timestamp sorts by id', () => {
  const a = encodeCursor({ ts: 1000, id: 'a' });
  const b = encodeCursor({ ts: 1000, id: 'b' });
  assert.ok(a < b);
});

test('compareCursors matches plain string comparison', () => {
  const a = encodeCursor({ ts: 1000, id: 'a' });
  const b = encodeCursor({ ts: 2000, id: 'a' });
  assert.equal(compareCursors(a, b), -1);
  assert.equal(compareCursors(b, a), 1);
  assert.equal(compareCursors(a, a), 0);
});

test('encodeCursor rejects a negative or non-integer ts', () => {
  assert.throws(() => encodeCursor({ ts: -1, id: 'a' }), RangeError);
  assert.throws(() => encodeCursor({ ts: 1.5, id: 'a' }), RangeError);
});

test('encodeCursor rejects an empty id', () => {
  assert.throws(() => encodeCursor({ ts: 1000, id: '' }), TypeError);
});

test('decodeCursor rejects malformed input', () => {
  assert.throws(() => decodeCursor('too-short'), TypeError);
  assert.throws(() => decodeCursor('000000000000000nosep'), TypeError);
});
