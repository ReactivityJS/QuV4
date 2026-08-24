import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DURABILITY } from '@qu/as2';
import {
  buildDataFrame,
  buildControlFrame,
  isDataFrame,
  isControlFrame,
  parseFrame,
  serializeFrame,
  frameKindForChange,
  persistentFrameKind,
  CONTROL_OP,
} from '../src/frame.js';

test('persistentFrameKind maps AS2 activity types to "activity", everything else to "object"', () => {
  assert.equal(persistentFrameKind({ type: 'Create' }), 'activity');
  assert.equal(persistentFrameKind({ type: 'Note' }), 'object');
});

test('frameKindForChange maps durability first, then persistent content shape', () => {
  assert.equal(frameKindForChange({ doc: { type: 'Note' }, durability: DURABILITY.EPHEMERAL }), 'ephemeral');
  assert.equal(frameKindForChange({ doc: { type: 'Note' }, durability: DURABILITY.SESSION }), 'session');
  assert.equal(frameKindForChange({ doc: { type: 'Note' }, durability: DURABILITY.PERSISTENT }), 'object');
  assert.equal(frameKindForChange({ doc: { type: 'Follow' }, durability: DURABILITY.PERSISTENT }), 'activity');
});

test('buildDataFrame builds a well-formed data frame from an ap-store change event', () => {
  const frame = buildDataFrame({
    id: 'https://relay.example/1',
    doc: { id: 'https://relay.example/1', type: 'Note' },
    collections: ['https://relay.example/outbox'],
    durability: DURABILITY.PERSISTENT,
  });
  assert.equal(frame.kind, 'object');
  assert.equal(frame.id, 'https://relay.example/1');
  assert.deepEqual(frame.collections, ['https://relay.example/outbox']);
  assert.equal('sessionId' in frame, false);
});

test('buildDataFrame attaches a cursor when ts is given, matching encodeCursor', () => {
  const frame = buildDataFrame({
    id: 'https://relay.example/1',
    doc: { id: 'https://relay.example/1' },
    durability: DURABILITY.PERSISTENT,
    ts: 1700000000000,
  });
  assert.equal(typeof frame.cursor, 'string');
  assert.equal(frame.cursor.startsWith('001700000000000'), true);
});

test('buildDataFrame omits cursor when ts is not given', () => {
  const frame = buildDataFrame({ id: 'x', doc: { id: 'x' }, durability: DURABILITY.PERSISTENT });
  assert.equal('cursor' in frame, false);
});

test('buildDataFrame includes sessionId only when given', () => {
  const frame = buildDataFrame({
    id: 'x',
    doc: { id: 'x' },
    durability: DURABILITY.SESSION,
    sessionId: 's1',
  });
  assert.equal(frame.kind, 'session');
  assert.equal(frame.sessionId, 's1');
});

test('buildControlFrame builds a control frame and rejects unknown ops', () => {
  const frame = buildControlFrame(CONTROL_OP.RESUME, { since: { x: 'cursor' } });
  assert.equal(frame.kind, 'control');
  assert.equal(frame.op, 'resume');
  assert.deepEqual(frame.since, { x: 'cursor' });
  assert.throws(() => buildControlFrame('bogus-op'));
});

test('buildControlFrame supports the hello handshake op', () => {
  const frame = buildControlFrame(CONTROL_OP.HELLO, { actorId: 'https://relay.example/actors/alice' });
  assert.equal(frame.op, 'hello');
  assert.equal(frame.actorId, 'https://relay.example/actors/alice');
});

test('isDataFrame / isControlFrame distinguish frame kinds', () => {
  const data = buildDataFrame({ id: 'x', doc: { id: 'x' }, durability: DURABILITY.PERSISTENT });
  const control = buildControlFrame(CONTROL_OP.SUBSCRIBE, { collectionId: 'x' });
  assert.equal(isDataFrame(data), true);
  assert.equal(isControlFrame(data), false);
  assert.equal(isDataFrame(control), false);
  assert.equal(isControlFrame(control), true);
  assert.equal(isDataFrame(null), false);
  assert.equal(isControlFrame(undefined), false);
});

test('serializeFrame/parseFrame round-trip', () => {
  const frame = buildDataFrame({ id: 'x', doc: { id: 'x', type: 'Note' }, durability: DURABILITY.PERSISTENT });
  const wire = serializeFrame(frame);
  assert.equal(typeof wire, 'string');
  assert.deepEqual(parseFrame(wire), frame);
});

test('parseFrame accepts an already-parsed object too', () => {
  const frame = buildControlFrame(CONTROL_OP.RESUME, { since: {} });
  assert.deepEqual(parseFrame(frame), frame);
});

test('parseFrame rejects malformed input', () => {
  assert.throws(() => parseFrame('{"kind":"not-a-real-kind"}'));
  assert.throws(() => parseFrame('null'));
  assert.throws(() => parseFrame('{"kind":"control"}')); // missing op
  assert.throws(() => parseFrame('not json at all'));
});
