// TTL-based in-memory adapter. Backs the two non-persistent event
// durability tiers (see docs/rewrite-plan.md § Event-Durability-Stufen):
//   - ephemeral: used only as a short dedup window, entries expire fast
//     and are never meant to be listed/replayed
//   - session: entries live exactly as long as the owning session, scoped
//     by key prefix and cleared explicitly when the session ends
// Same list() shape as MemoryStoreAdapter so ap-store can treat both
// uniformly, but this one forgets things on purpose.

const DEFAULT_TTL_MS = 60_000;

export class VolatileAdapter {
  #entries = new Map(); // key -> { value, expiresAt }
  #defaultTtlMs;

  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.#defaultTtlMs = ttlMs;
  }

  async put(key, value, { ttlMs = this.#defaultTtlMs } = {}) {
    this.#prune();
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async get(key) {
    this.#prune();
    const entry = this.#entries.get(key);
    return entry ? entry.value : undefined;
  }

  async has(key) {
    return (await this.get(key)) !== undefined;
  }

  async delete(key) {
    this.#entries.delete(key);
  }

  async list({ prefix = '', limit = Infinity, reverse = false } = {}) {
    this.#prune();
    let keys = [...this.#entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    if (reverse) keys.reverse();
    if (Number.isFinite(limit)) keys = keys.slice(0, limit);
    return keys.map((key) => ({ key, value: this.#entries.get(key).value }));
  }

  /** Remove every entry whose key starts with `prefix` (e.g. a whole session). */
  clear(prefix = '') {
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }

  #prune() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}
