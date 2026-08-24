import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintLocalId, mintId } from '../src/id.js';

test('mintLocalId produces a 26-char Crockford base32 string', () => {
  const id = mintLocalId();
  assert.equal(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('mintLocalId is unique across calls', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => mintLocalId()));
  assert.equal(ids.size, 1000);
});

test('mintLocalId is lexicographically sortable by time', () => {
  const early = mintLocalId(1_000_000);
  const late = mintLocalId(2_000_000);
  assert.ok(early < late);
});

test('mintId builds a URL under actorBase/collection', () => {
  const id = mintId({ actorBase: 'https://relay.example/actors/abc', collection: 'outbox' });
  assert.match(id, /^https:\/\/relay\.example\/actors\/abc\/outbox\/[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('mintId strips a trailing slash on actorBase', () => {
  const id = mintId({
    actorBase: 'https://relay.example/actors/abc/',
    collection: 'outbox',
    localId: 'X',
  });
  assert.equal(id, 'https://relay.example/actors/abc/outbox/X');
});

test('mintId requires actorBase and collection', () => {
  assert.throws(() => mintId({ collection: 'outbox' }));
  assert.throws(() => mintId({ actorBase: 'https://relay.example/actors/abc' }));
});
