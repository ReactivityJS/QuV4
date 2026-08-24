import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderedCollection, buildOrderedCollectionPage } from '../src/collections.js';

test('buildOrderedCollection builds a summary with first/last', () => {
  const c = buildOrderedCollection({
    id: 'https://relay.example/actors/alice/outbox',
    totalItems: 3,
    first: 'https://relay.example/actors/alice/outbox?page=1',
  });
  assert.equal(c.type, 'OrderedCollection');
  assert.equal(c.totalItems, 3);
  assert.equal(c.first, 'https://relay.example/actors/alice/outbox?page=1');
  assert.equal('last' in c, false);
});

test('buildOrderedCollection defaults totalItems to 0', () => {
  const c = buildOrderedCollection({ id: 'https://relay.example/x' });
  assert.equal(c.totalItems, 0);
});

test('buildOrderedCollection requires an id', () => {
  assert.throws(() => buildOrderedCollection({}));
});

test('buildOrderedCollectionPage builds a page with items and paging links', () => {
  const page = buildOrderedCollectionPage({
    id: 'https://relay.example/actors/alice/outbox?page=1',
    partOf: 'https://relay.example/actors/alice/outbox',
    items: [{ id: 'https://relay.example/activities/1' }],
    next: 'https://relay.example/actors/alice/outbox?page=2',
  });
  assert.equal(page.type, 'OrderedCollectionPage');
  assert.equal(page.orderedItems.length, 1);
  assert.equal(page.next, 'https://relay.example/actors/alice/outbox?page=2');
  assert.equal('prev' in page, false);
});

test('buildOrderedCollectionPage defaults items to an empty array', () => {
  const page = buildOrderedCollectionPage({
    id: 'https://relay.example/x?page=1',
    partOf: 'https://relay.example/x',
  });
  assert.deepEqual(page.orderedItems, []);
});

test('buildOrderedCollectionPage requires id and partOf', () => {
  assert.throws(() => buildOrderedCollectionPage({ partOf: 'https://relay.example/x' }));
  assert.throws(() => buildOrderedCollectionPage({ id: 'https://relay.example/x?page=1' }));
});
