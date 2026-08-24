// Filesystem vault adapter for Node (relay/CLI contexts). Each key becomes
// its own file under a dedicated directory with restrictive permissions
// (0700 dir, 0600 files) — a directory that nothing else in the repo reads
// from or writes to, which is the "physical separation" the rewrite plan
// calls for (replacement for QuV3's `LOCAL_ONLY_PREFIX` convention).

import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function filenameFor(key) {
  return `${encodeURIComponent(key)}.json`;
}

function keyFromFilename(filename) {
  return decodeURIComponent(filename.replace(/\.json$/, ''));
}

export class FsVaultAdapter {
  #dir;
  #ready;

  constructor(dir) {
    if (!dir) throw new Error('FsVaultAdapter: dir is required');
    this.#dir = dir;
  }

  async #ensureDir() {
    this.#ready ??= mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await this.#ready;
  }

  async get(key) {
    await this.#ensureDir();
    try {
      const raw = await readFile(join(this.#dir, filenameFor(key)), 'utf8');
      const record = JSON.parse(raw);
      return record.type === 'buffer' ? Buffer.from(record.data, 'base64') : record.data;
    } catch (err) {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async set(key, value) {
    await this.#ensureDir();
    const record = Buffer.isBuffer(value)
      ? { type: 'buffer', data: value.toString('base64') }
      : { type: 'json', data: value };
    await writeFile(join(this.#dir, filenameFor(key)), JSON.stringify(record), { mode: 0o600 });
  }

  async delete(key) {
    await this.#ensureDir();
    await rm(join(this.#dir, filenameFor(key)), { force: true });
  }

  async keys() {
    await this.#ensureDir();
    const entries = await readdir(this.#dir);
    return entries.filter((name) => name.endsWith('.json')).map(keyFromFilename);
  }
}
