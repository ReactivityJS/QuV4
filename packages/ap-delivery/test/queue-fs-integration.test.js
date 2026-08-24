// Confirms the delivery queue survives a process restart when backed by
// durable storage — this is the actual offline-first guarantee: an
// activity that couldn't be delivered before the process died is still
// queued afterward, not silently lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsAdapter } from '@qu/runtime';
import { ApStore } from '@qu/ap-store';
import { DeliveryQueue } from '../src/queue.js';

const QUEUE_COLLECTION = 'https://relay.example/actors/alice#delivery-queue';

test('a queued entry survives across separate ApStore/DeliveryQueue instances (simulated restart)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qu-ap-delivery-fs-'));
  try {
    const activity = { id: 'https://relay.example/activities/1', type: 'Create' };

    const queue1 = new DeliveryQueue({
      store: new ApStore({ adapter: new FsAdapter(dir) }),
      collectionId: QUEUE_COLLECTION,
      keyId: 'https://relay.example/actors/alice#transport-key',
      privateKey: 'fake-private-key',
      resolveInboxesImpl: async () => ({ inboxes: [], errors: [{ id: 'x', message: 'offline' }] }),
      deliverImpl: async () => [],
    });
    await queue1.enqueue(activity, ['https://target.example/actors/bob']);
    await queue1.processDue(); // fails (simulated offline), stays queued with backoff

    // Simulate a process restart: fresh ApStore/DeliveryQueue instances,
    // same underlying directory.
    const queue2 = new DeliveryQueue({
      store: new ApStore({ adapter: new FsAdapter(dir) }),
      collectionId: QUEUE_COLLECTION,
      keyId: 'https://relay.example/actors/alice#transport-key',
      privateKey: 'fake-private-key',
      resolveInboxesImpl: async () => ({ inboxes: ['https://target.example/inbox'], errors: [] }),
      deliverImpl: async () => [{ inbox: 'https://target.example/inbox', ok: true, status: 202 }],
    });
    const pending = await queue2.pending();
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].activity, activity);
    assert.equal(pending[0].attempts, 1);

    const results = await queue2.processDue(pending[0].nextAttemptAt);
    assert.equal(results[0].ok, true);
    assert.deepEqual(await queue2.pending(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
