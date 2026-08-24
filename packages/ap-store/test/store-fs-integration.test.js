// Confirms ApStore works against a real durable adapter (not just the
// in-memory one used by the rest of the test suite) — this is what QuRelay
// and the offline-first client-side ap-store copy both actually run on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsAdapter } from '@qu/runtime';
import { ApStore } from '../src/store.js';

test('ApStore persists across separate instances when backed by FsAdapter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qu-ap-store-fs-'));
  try {
    const outbox = 'https://relay.example/actors/alice/outbox';
    const doc = { id: 'https://relay.example/notes/1', type: 'Note', content: 'hi' };

    const store1 = new ApStore({ adapter: new FsAdapter(dir) });
    await store1.put(doc, { collections: [outbox] });

    const store2 = new ApStore({ adapter: new FsAdapter(dir) });
    assert.deepEqual(await store2.get(doc.id), doc);
    assert.deepEqual(
      (await store2.getChildren(outbox)).map((d) => d.id),
      [doc.id],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
