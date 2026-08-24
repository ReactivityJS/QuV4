import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertClientTransport, assertServerTransport } from '../src/transport.js';

test('assertClientTransport accepts a fully-shaped object', () => {
  const fake = { connect() {}, send() {}, onMessage() {}, onClose() {}, close() {}, getPeerId() {} };
  assert.doesNotThrow(() => assertClientTransport(fake));
});

test('assertClientTransport reports every missing method', () => {
  assert.throws(() => assertClientTransport({}), /connect.*send.*onMessage.*onClose.*close.*getPeerId/s);
});

test('assertServerTransport accepts a fully-shaped object', () => {
  const fake = { onConnection() {}, sendTo() {}, broadcast() {}, close() {} };
  assert.doesNotThrow(() => assertServerTransport(fake));
});

test('assertServerTransport reports missing methods', () => {
  assert.throws(() => assertServerTransport({ close() {} }), /onConnection.*sendTo.*broadcast/s);
});
