import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStoreAdapter } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { DeliveryQueue } from '../src/queue.js';

const QUEUE_COLLECTION = 'https://relay.example/actors/alice#delivery-queue';
const KEY_ID = 'https://relay.example/actors/alice#transport-key';

function makeQueue({ resolveInboxesImpl, deliverImpl, maxAttempts } = {}) {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const queue = new DeliveryQueue({
    store,
    collectionId: QUEUE_COLLECTION,
    keyId: KEY_ID,
    privateKey: 'fake-private-key',
    resolveInboxesImpl: resolveInboxesImpl ?? (async () => ({ inboxes: ['https://target.example/inbox'], errors: [] })),
    deliverImpl: deliverImpl ?? (async () => [{ inbox: 'https://target.example/inbox', ok: true, status: 202 }]),
    maxAttempts,
  });
  return { store, queue };
}

test('requires store, collectionId, keyId and privateKey', () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  assert.throws(() => new DeliveryQueue({ collectionId: 'x', keyId: 'k', privateKey: 'p' }));
  assert.throws(() => new DeliveryQueue({ store, keyId: 'k', privateKey: 'p' }));
  assert.throws(() => new DeliveryQueue({ store, collectionId: 'x', privateKey: 'p' }));
  assert.throws(() => new DeliveryQueue({ store, collectionId: 'x', keyId: 'k' }));
});

test('enqueue stores a durable, immediately-due entry', async () => {
  const { queue } = makeQueue();
  const activity = { id: 'https://relay.example/activities/1', type: 'Create' };
  const entry = await queue.enqueue(activity, ['https://target.example/actors/bob']);
  assert.equal(entry.attempts, 0);
  assert.ok(entry.nextAttemptAt <= Date.now());

  const pending = await queue.pending();
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].activity, activity);
});

test('processDue delivers and removes a successful entry', async () => {
  const { queue } = makeQueue();
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://target.example/actors/bob']);

  const results = await queue.processDue();
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.deepEqual(await queue.pending(), []);
});

test('processDue reschedules a failed entry with backoff, keeping it queued', async () => {
  const { queue } = makeQueue({
    deliverImpl: async () => [{ inbox: 'https://target.example/inbox', ok: false, error: '503' }],
  });
  const now = Date.now();
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://target.example/actors/bob']);

  const results = await queue.processDue(now);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].giveUp, false);
  assert.equal(results[0].attempts, 1);
  assert.ok(results[0].nextAttemptAt > now);

  const pending = await queue.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempts, 1);
  assert.equal(pending[0].lastError, '503');
});

test('processDue skips an entry whose backoff has not elapsed yet', async () => {
  let deliverCalls = 0;
  const { queue } = makeQueue({
    deliverImpl: async () => {
      deliverCalls += 1;
      return [{ inbox: 'https://target.example/inbox', ok: false, error: 'down' }];
    },
  });
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://target.example/actors/bob']);
  await queue.processDue(); // fails once, schedules a retry well into the future
  assert.equal(deliverCalls, 1);

  // Immediately after (real clock): backoff has not elapsed, so no delivery attempt.
  const results = await queue.processDue();
  assert.deepEqual(results, []);
  assert.equal(deliverCalls, 1);
});

test('processDue retries once the backoff has elapsed', async () => {
  let deliverCalls = 0;
  const { queue } = makeQueue({
    deliverImpl: async () => {
      deliverCalls += 1;
      return deliverCalls === 1
        ? [{ inbox: 'https://target.example/inbox', ok: false, error: 'down' }]
        : [{ inbox: 'https://target.example/inbox', ok: true, status: 202 }];
    },
  });
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://target.example/actors/bob']);
  const first = await queue.processDue();
  const nextAttemptAt = first[0].nextAttemptAt;

  const second = await queue.processDue(nextAttemptAt);
  assert.equal(second.length, 1);
  assert.equal(second[0].ok, true);
  assert.deepEqual(await queue.pending(), []);
});

test('processDue gives up and removes the entry after maxAttempts', async () => {
  const { queue } = makeQueue({
    maxAttempts: 2,
    deliverImpl: async () => [{ inbox: 'https://target.example/inbox', ok: false, error: 'down' }],
  });
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://target.example/actors/bob']);

  let now = Date.now();
  const first = await queue.processDue(now);
  assert.equal(first[0].giveUp, false);

  now = first[0].nextAttemptAt;
  const second = await queue.processDue(now);
  assert.equal(second[0].giveUp, true);
  assert.equal(second[0].attempts, 2);
  assert.deepEqual(await queue.pending(), []);
});

test('an inbox-resolution error also counts as a delivery failure', async () => {
  const { queue } = makeQueue({
    resolveInboxesImpl: async () => ({ inboxes: [], errors: [{ id: 'https://gone.example/x', message: 'not found' }] }),
  });
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://gone.example/x']);

  const results = await queue.processDue();
  assert.equal(results[0].ok, false);
  assert.equal(results[0].lastError, 'not found');
});

test('multiple queued entries are processed independently', async () => {
  const outcomes = { 'https://relay.example/activities/1': true, 'https://relay.example/activities/2': false };
  const { queue } = makeQueue({
    deliverImpl: async (activity) => [
      { inbox: 'https://target.example/inbox', ok: outcomes[activity.id], error: 'down' },
    ],
  });
  await queue.enqueue({ id: 'https://relay.example/activities/1' }, ['https://target.example/actors/bob']);
  await queue.enqueue({ id: 'https://relay.example/activities/2' }, ['https://target.example/actors/bob']);

  const results = await queue.processDue();
  assert.equal(results.length, 2);
  const byId = Object.fromEntries(results.map((r) => [r.id.includes('1') ? '1' : '2', r.ok]));
  assert.deepEqual(byId, { '1': true, '2': false });
  assert.equal((await queue.pending()).length, 1);
});
