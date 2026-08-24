// Generic in-memory ordered-KV adapter. This is the adapter *interface*
// every storage backend (memory, Fs, later IndexedDB) implements:
//   put(key, value), get(key), delete(key), list({ prefix, limit, reverse })
// ap-store is built only against this interface, never against a concrete
// adapter — swapping Memory for Fs/IndexedDB changes nothing above it.

export class MemoryStoreAdapter {
  #entries = new Map();

  async put(key, value) {
    this.#entries.set(key, value);
  }

  async get(key) {
    return this.#entries.has(key) ? this.#entries.get(key) : undefined;
  }

  async delete(key) {
    this.#entries.delete(key);
  }

  /**
   * List entries in key order.
   * @param {object} [options]
   * @param {string} [options.prefix] - only keys starting with this
   * @param {number} [options.limit] - max entries to return
   * @param {boolean} [options.reverse] - descending key order instead of ascending
   * @returns {Promise<{key: string, value: *}[]>}
   */
  async list({ prefix = '', limit = Infinity, reverse = false } = {}) {
    let keys = [...this.#entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    if (reverse) keys.reverse();
    if (Number.isFinite(limit)) keys = keys.slice(0, limit);
    return keys.map((key) => ({ key, value: this.#entries.get(key) }));
  }
}
