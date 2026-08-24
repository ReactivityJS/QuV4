// Node filesystem-backed ordered-KV adapter — implements the same
// interface as @qu/core's MemoryStoreAdapter/VolatileAdapter
// (put/get/delete/list), so ap-store can run against durable storage on
// QuRelay (or any Node CLI context) without knowing it isn't in-memory.
// Each key becomes its own file in a flat directory; list() reads the
// directory, decodes filenames back to keys, and sorts — fine at the
// scale a single actor's store operates at, and simple enough to reason
// about for the offline-first outbox/inbox use case.

import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function filenameFor(key) {
  return `${encodeURIComponent(key)}.json`;
}

function keyFromFilename(filename) {
  return decodeURIComponent(filename.replace(/\.json$/, ''));
}

export class FsAdapter {
  #dir;
  #ready;

  constructor(dir) {
    if (!dir) throw new Error('FsAdapter: dir is required');
    this.#dir = dir;
  }

  async #ensureDir() {
    this.#ready ??= mkdir(this.#dir, { recursive: true });
    await this.#ready;
  }

  async put(key, value) {
    await this.#ensureDir();
    await writeFile(join(this.#dir, filenameFor(key)), JSON.stringify(value));
  }

  async get(key) {
    await this.#ensureDir();
    try {
      const raw = await readFile(join(this.#dir, filenameFor(key)), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async delete(key) {
    await this.#ensureDir();
    await rm(join(this.#dir, filenameFor(key)), { force: true });
  }

  async list({ prefix = '', limit = Infinity, reverse = false } = {}) {
    await this.#ensureDir();
    const filenames = await readdir(this.#dir);
    let keys = filenames
      .filter((name) => name.endsWith('.json'))
      .map(keyFromFilename)
      .filter((key) => key.startsWith(prefix))
      .sort();
    if (reverse) keys.reverse();
    if (Number.isFinite(limit)) keys = keys.slice(0, limit);

    const entries = [];
    for (const key of keys) {
      entries.push({ key, value: await this.get(key) });
    }
    return entries;
  }
}
