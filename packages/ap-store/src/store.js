// ApStore — the single storage API for everything in the system that
// isn't Class A (device-local, never synced): get()/put()/getChildren()/
// onChange(), used identically for Class B (private, cross-device) and
// Class C (federated/social) data. See docs/rewrite-plan.md § Storage-
// Modell.
//
// Three record shapes fall out of the three event durability tiers
// (§ Event-Durability-Stufen), because durability *is* the storage
// decision:
//   - persistent -> written to the adapter (Memory/Fs/IndexedDB later),
//     indexed under every collection it's addressed to, replayable.
//   - session    -> written to an in-memory VolatileAdapter, scoped by
//     session id, gone when endSession() is called (or a long safety-net
//     ttl expires, for an abandoned session that never called it).
//   - ephemeral  -> never stored at all; only a short dedup window (a
//     *separate* VolatileAdapter, its own short ttl) so a duplicate
//     delivery doesn't re-emit a change event.
//
// `collections` on put() plays the role AS2 `to`/`cc`/etc. would for
// delivery (a later phase's concern) — here it just means "index this
// object's id under these collection ids" (e.g. an actor's outbox or
// inbox URL), so getChildren() can list them back out in delivery order.

import { QuEvents, VolatileAdapter, encodeCursor } from '@qu/core';
import { DURABILITY, isDurabilityTier } from '@qu/as2';

const OBJECT_PREFIX = 'obj/';
const INDEX_PREFIX = 'idx/';
const COLLECTION_DELIM = '';
const EPHEMERAL_DEDUP_TTL_MS = 30_000;
// Session storage isn't meant to expire on its own — endSession() is the
// real lifecycle boundary — but a long safety-net ttl guards against a
// session that's simply abandoned (client crash, tab closed) without ever
// calling endSession().
const SESSION_SAFETY_NET_TTL_MS = 24 * 60 * 60 * 1000;

function objectKey(id) {
  return `${OBJECT_PREFIX}${id}`;
}

function indexKeyPrefix(collectionId) {
  return `${INDEX_PREFIX}${collectionId}${COLLECTION_DELIM}`;
}

function indexKey(collectionId, ts, id) {
  return `${indexKeyPrefix(collectionId)}${encodeCursor({ ts, id })}`;
}

export class ApStore {
  #adapter;
  #volatile;
  #dedup;
  #events;

  /**
   * @param {object} params
   * @param {object} params.adapter - a persistent ordered-KV adapter (MemoryStoreAdapter, FsAdapter, ...)
   * @param {object} [params.volatile] - backs 'session' durability, default a fresh long-ttl VolatileAdapter
   * @param {object} [params.dedup] - backs the 'ephemeral' dedup window, default a fresh short-ttl VolatileAdapter
   * @param {QuEvents} [params.events] - the shared QuEvents bus, default a fresh private one
   */
  constructor({ adapter, volatile, dedup, events } = {}) {
    if (!adapter) throw new Error('ApStore: adapter is required');
    this.#adapter = adapter;
    this.#volatile = volatile ?? new VolatileAdapter({ ttlMs: SESSION_SAFETY_NET_TTL_MS });
    this.#dedup = dedup ?? new VolatileAdapter({ ttlMs: EPHEMERAL_DEDUP_TTL_MS });
    this.#events = events ?? new QuEvents();
  }

  /**
   * Store an AS2 object/activity, or hand off an ephemeral/session event.
   *
   * @param {object} doc - AS2 document; must have a string `id`.
   * @param {object} [options]
   * @param {string[]} [options.collections] - collection ids this doc is indexed under (e.g. an outbox URL)
   * @param {string} [options.durability] - one of DURABILITY, default 'persistent'
   * @param {string} [options.sessionId] - required when durability === 'session'
   * @param {number} [options.ts] - override timestamp, default Date.now()
   * @returns {Promise<object>} the stored doc
   */
  async put(doc, { collections = [], durability = DURABILITY.PERSISTENT, sessionId, ts = Date.now() } = {}) {
    if (!doc || typeof doc.id !== 'string' || doc.id.length === 0) {
      throw new Error('ApStore.put: doc.id is required');
    }
    if (!isDurabilityTier(durability)) {
      throw new Error(`ApStore.put: unknown durability tier '${durability}'`);
    }

    if (durability === DURABILITY.EPHEMERAL) {
      const alreadySeen = await this.#dedup.has(doc.id);
      await this.#dedup.put(doc.id, true);
      if (!alreadySeen) {
        this.#events.emit('change', { id: doc.id, doc, durability, collections });
      }
      return doc;
    }

    if (durability === DURABILITY.SESSION) {
      if (!sessionId) throw new Error("ApStore.put: sessionId is required for 'session' durability");
      await this.#volatile.put(`session/${sessionId}/${OBJECT_PREFIX}${doc.id}`, doc);
      for (const collectionId of collections) {
        await this.#volatile.put(
          `session/${sessionId}/${indexKey(collectionId, ts, doc.id)}`,
          doc.id,
        );
      }
      this.#events.emit('change', { id: doc.id, doc, durability, collections, sessionId });
      return doc;
    }

    // persistent
    await this.#adapter.put(objectKey(doc.id), { ts, doc, collections });
    for (const collectionId of collections) {
      await this.#adapter.put(indexKey(collectionId, ts, doc.id), doc.id);
    }
    this.#events.emit('change', { id: doc.id, doc, durability, collections });
    return doc;
  }

  /** Read a persisted doc back by id, or null if it isn't stored (or is session/ephemeral-only). */
  async get(id) {
    const record = await this.#adapter.get(objectKey(id));
    return record ? record.doc : null;
  }

  /** Delete a persisted doc and its collection index entries. */
  async delete(id) {
    const record = await this.#adapter.get(objectKey(id));
    if (!record) return;
    await this.#adapter.delete(objectKey(id));
    for (const collectionId of record.collections ?? []) {
      await this.#adapter.delete(indexKey(collectionId, record.ts, id));
    }
    this.#events.emit('change', {
      id,
      doc: null,
      durability: DURABILITY.PERSISTENT,
      collections: record.collections ?? [],
    });
  }

  /**
   * List the persisted members of a collection (e.g. an actor's outbox),
   * newest first — matching AS2 outbox/inbox delivery-order convention.
   * `packages/reactive`'s watchChildren() always re-reads through this,
   * never off the raw change-event payload.
   */
  async getChildren(collectionId, { limit = 50 } = {}) {
    const entries = await this.#adapter.list({
      prefix: indexKeyPrefix(collectionId),
      reverse: true,
      limit,
    });
    const docs = [];
    for (const entry of entries) {
      const doc = await this.get(entry.value);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  /** Session-scoped children (durability: 'session') — volatile, in-memory only. */
  async getSessionChildren(sessionId, collectionId, { limit = 50 } = {}) {
    const entries = await this.#volatile.list({
      prefix: `session/${sessionId}/${indexKeyPrefix(collectionId)}`,
      reverse: true,
      limit,
    });
    const docs = [];
    for (const entry of entries) {
      const doc = await this.#volatile.get(`session/${sessionId}/${OBJECT_PREFIX}${entry.value}`);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  /** End a session: wipe every session-scoped entry belonging to it. */
  endSession(sessionId) {
    this.#volatile.clear(`session/${sessionId}/`);
  }

  /**
   * Subscribe to change notifications: `({ id, doc, durability, collections,
   * sessionId? }) => void`. `doc` is null on delete. Returns an unsubscribe
   * function.
   */
  onChange(callback) {
    return this.#events.on('change', callback);
  }
}
