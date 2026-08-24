import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuEvents } from '../src/events.js';

test('on subscribes and emit invokes with args', () => {
  const bus = new QuEvents();
  const calls = [];
  bus.on('change', (a, b) => calls.push([a, b]));
  bus.emit('change', 1, 2);
  assert.deepEqual(calls, [[1, 2]]);
});

test('emit with no listeners is a no-op', () => {
  const bus = new QuEvents();
  assert.doesNotThrow(() => bus.emit('nothing'));
});

test('on returns an unsubscribe function', () => {
  const bus = new QuEvents();
  const calls = [];
  const unsubscribe = bus.on('change', () => calls.push(1));
  bus.emit('change');
  unsubscribe();
  bus.emit('change');
  assert.equal(calls.length, 1);
});

test('off removes a specific listener', () => {
  const bus = new QuEvents();
  const calls = [];
  const fn = () => calls.push(1);
  bus.on('change', fn);
  bus.off('change', fn);
  bus.emit('change');
  assert.equal(calls.length, 0);
});

test('once fires exactly one time', () => {
  const bus = new QuEvents();
  const calls = [];
  bus.once('change', () => calls.push(1));
  bus.emit('change');
  bus.emit('change');
  assert.equal(calls.length, 1);
});

test('listenerCount reflects current subscriptions', () => {
  const bus = new QuEvents();
  assert.equal(bus.listenerCount('change'), 0);
  const unsubscribe = bus.on('change', () => {});
  assert.equal(bus.listenerCount('change'), 1);
  bus.on('change', () => {});
  assert.equal(bus.listenerCount('change'), 2);
  unsubscribe();
  assert.equal(bus.listenerCount('change'), 1);
});

test('multiple listeners for the same event all fire, in subscription order', () => {
  const bus = new QuEvents();
  const order = [];
  bus.on('change', () => order.push('a'));
  bus.on('change', () => order.push('b'));
  bus.emit('change');
  assert.deepEqual(order, ['a', 'b']);
});

test('events are isolated per event name', () => {
  const bus = new QuEvents();
  const calls = [];
  bus.on('a', () => calls.push('a'));
  bus.on('b', () => calls.push('b'));
  bus.emit('a');
  assert.deepEqual(calls, ['a']);
});

test('a listener unsubscribing itself during emit does not break dispatch to others', () => {
  const bus = new QuEvents();
  const calls = [];
  let unsubscribeSelf;
  unsubscribeSelf = bus.on('change', () => {
    calls.push('self');
    unsubscribeSelf();
  });
  bus.on('change', () => calls.push('other'));
  bus.emit('change');
  assert.deepEqual(calls, ['self', 'other']);
  bus.emit('change');
  assert.deepEqual(calls, ['self', 'other', 'other']);
});

test('on/once/emit reject a non-function listener', () => {
  const bus = new QuEvents();
  assert.throws(() => bus.on('change', 'not a function'), TypeError);
  assert.throws(() => bus.once('change', 123), TypeError);
});
