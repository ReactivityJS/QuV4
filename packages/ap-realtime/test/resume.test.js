import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStoreAdapter } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { replayResume } from '../src/resume.js';
import { isControlFrame, CONTROL_OP } from '../src/frame.js';

function makeStore() {
  return new ApStore({ adapter: new MemoryStoreAdapter() });
}

test('with no prior cursor, replays every persisted entry oldest-first, then a resumed frame', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox], ts: 1000 });
  await store.put({ id: 'https://relay.example/2' }, { collections: [outbox], ts: 2000 });

  const sent = [];
  const cursors = await replayResume({ store, subscriptions: [outbox], send: (f) => sent.push(f) });

  const dataFrames = sent.filter((f) => !isControlFrame(f));
  assert.deepEqual(dataFrames.map((f) => f.id), ['https://relay.example/1', 'https://relay.example/2']);

  const last = sent.at(-1);
  assert.equal(isControlFrame(last), true);
  assert.equal(last.op, CONTROL_OP.RESUMED);
  assert.equal(cursors[outbox], last.cursors[outbox]);
});

test('resuming from a cursor only replays what came after it', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox], ts: 1000 });
  const midCursor = (await store.getChildrenSince(outbox))[0].cursor;
  await store.put({ id: 'https://relay.example/2' }, { collections: [outbox], ts: 2000 });

  const sent = [];
  await replayResume({ store, subscriptions: [outbox], since: { [outbox]: midCursor }, send: (f) => sent.push(f) });

  const dataFrames = sent.filter((f) => !isControlFrame(f));
  assert.deepEqual(dataFrames.map((f) => f.id), ['https://relay.example/2']);
});

test('resuming an already-caught-up collection replays nothing but still sends resumed', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  await store.put({ id: 'https://relay.example/1' }, { collections: [outbox], ts: 1000 });
  const latest = (await store.getChildrenSince(outbox))[0].cursor;

  const sent = [];
  const cursors = await replayResume({ store, subscriptions: [outbox], since: { [outbox]: latest }, send: (f) => sent.push(f) });

  assert.deepEqual(sent.filter((f) => !isControlFrame(f)), []);
  assert.equal(cursors[outbox], latest);
});

test('replays multiple subscribed collections independently', async () => {
  const store = makeStore();
  const outbox = 'https://relay.example/actors/alice/outbox';
  const settings = 'https://relay.example/actors/alice/settings';
  await store.put({ id: 'https://relay.example/o1' }, { collections: [outbox], ts: 1000 });
  await store.put({ id: 'https://relay.example/s1' }, { collections: [settings], ts: 1000 });

  const sent = [];
  const cursors = await replayResume({ store, subscriptions: [outbox, settings], send: (f) => sent.push(f) });

  const ids = sent.filter((f) => !isControlFrame(f)).map((f) => f.id);
  assert.deepEqual(ids.sort(), ['https://relay.example/o1', 'https://relay.example/s1']);
  assert.ok(cursors[outbox]);
  assert.ok(cursors[settings]);
});

test('a never-before-seen empty collection resumes with a null cursor', async () => {
  const store = makeStore();
  const empty = 'https://relay.example/actors/alice/empty';
  const sent = [];
  const cursors = await replayResume({ store, subscriptions: [empty], send: (f) => sent.push(f) });
  assert.equal(cursors[empty], null);
  assert.deepEqual(sent.filter((f) => !isControlFrame(f)), []);
});
