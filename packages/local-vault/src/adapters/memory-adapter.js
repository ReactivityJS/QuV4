// In-memory vault adapter — for tests and ephemeral/relay-side use where
// persistence across restarts isn't needed.

export class MemoryVaultAdapter {
  #entries = new Map();

  async get(key) {
    return this.#entries.has(key) ? this.#entries.get(key) : undefined;
  }

  async set(key, value) {
    this.#entries.set(key, value);
  }

  async delete(key) {
    this.#entries.delete(key);
  }

  async keys() {
    return [...this.#entries.keys()];
  }
}
