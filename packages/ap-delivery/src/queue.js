// DeliveryQueue — the persistent-tier delivery retry queue. This *is* the
// server-side half of the offline-first outbox (see docs/rewrite-plan.md
// "Ergänzung" § 1): a publish that can't be delivered right now (remote
// server down, network partition) stays queued and durable — backed by
// ap-store, `durability: 'persistent'` — until a later processDue() call
// succeeds, gives up after maxAttempts, or the process restarts and picks
// up exactly where it left off.
//
// Callers are expected to pass `recipients` already stripped of the
// public-audience marker (@qu/as2's normalizeAudience(activity).recipients
// is exactly that) — this module only resolves and delivers to individual
// actor inboxes, never to the public collection itself.

import { resolveInboxes } from './resolve-inboxes.js';
import { deliverActivity } from './deliver.js';

const DEFAULT_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

function backoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

// No encodeURIComponent here: this id itself gets embedded again in an
// index key downstream (collectionId + this id), and an FsAdapter turns
// the whole key into a filename via its own encodeURIComponent — stacking
// percent-encodings on top of URLs already full of ':' and '/' blows past
// typical filesystem filename length limits (NAME_MAX=255 on ext4). A
// plain control-character delimiter avoids adding any encoded bytes here.
function entryIdFor(collectionId, activityId) {
  return `urn:qu:delivery-queue-entry:${collectionId}${activityId}`;
}

export class DeliveryQueue {
  #store;
  #collectionId;
  #keyId;
  #privateKey;
  #resolveInboxesImpl;
  #deliverImpl;
  #maxAttempts;

  constructor({
    store,
    collectionId,
    keyId,
    privateKey,
    resolveInboxesImpl = resolveInboxes,
    deliverImpl = deliverActivity,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  }) {
    if (!store) throw new Error('DeliveryQueue: store is required');
    if (!collectionId) throw new Error('DeliveryQueue: collectionId is required');
    if (!keyId) throw new Error('DeliveryQueue: keyId is required');
    if (!privateKey) throw new Error('DeliveryQueue: privateKey is required');
    this.#store = store;
    this.#collectionId = collectionId;
    this.#keyId = keyId;
    this.#privateKey = privateKey;
    this.#resolveInboxesImpl = resolveInboxesImpl;
    this.#deliverImpl = deliverImpl;
    this.#maxAttempts = maxAttempts;
  }

  /** Queue an activity for delivery to `recipients` (actor ids). Returns the queue entry. */
  async enqueue(activity, recipients) {
    const now = Date.now();
    const entry = {
      id: entryIdFor(this.#collectionId, activity.id),
      activity,
      recipients,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
    };
    await this.#store.put(entry, { collections: [this.#collectionId], ts: now });
    return entry;
  }

  /** All currently-queued entries (delivered or given-up entries are removed, not listed here). */
  async pending() {
    return this.#store.getChildren(this.#collectionId, { limit: Infinity });
  }

  /**
   * Attempt delivery for every entry whose `nextAttemptAt` has passed.
   * Success removes the entry; failure reschedules it with exponential
   * backoff; exceeding maxAttempts removes it (a give-up, not a success).
   * Callers own the schedule — call this periodically, or on reconnect.
   */
  async processDue(now = Date.now()) {
    const entries = await this.pending();
    const results = [];

    for (const entry of entries) {
      if (entry.nextAttemptAt > now) continue;

      const { inboxes, errors } = await this.#resolveInboxesImpl(entry.recipients);
      const deliveryResults =
        inboxes.length > 0
          ? await this.#deliverImpl(entry.activity, { inboxes, keyId: this.#keyId, privateKey: this.#privateKey })
          : [];
      const failedDeliveries = deliveryResults.filter((r) => !r.ok);
      const hasFailures = failedDeliveries.length > 0 || errors.length > 0;

      if (!hasFailures) {
        await this.#store.delete(entry.id);
        results.push({ id: entry.id, ok: true, attempts: entry.attempts + 1 });
        continue;
      }

      const attempts = entry.attempts + 1;
      const lastError = failedDeliveries[0]?.error ?? errors[0]?.message ?? 'unknown delivery error';

      if (attempts >= this.#maxAttempts) {
        await this.#store.delete(entry.id);
        results.push({ id: entry.id, ok: false, giveUp: true, attempts, lastError });
        continue;
      }

      const updated = { ...entry, attempts, lastError, nextAttemptAt: now + backoffMs(attempts) };
      await this.#store.put(updated, { collections: [this.#collectionId], ts: now });
      results.push({
        id: entry.id,
        ok: false,
        giveUp: false,
        attempts,
        lastError,
        nextAttemptAt: updated.nextAttemptAt,
      });
    }

    return results;
  }
}
