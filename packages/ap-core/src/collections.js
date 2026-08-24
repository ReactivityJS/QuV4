// AS2 Collection / OrderedCollection(Page) serialization helpers. Used
// wherever ap-store's index trees (inbox, outbox, followers, ...) need to
// be surfaced as paged AS2 collections.

/**
 * Build a top-level OrderedCollection summary document (no inline items —
 * points to first/last pages).
 */
export function buildOrderedCollection({ id, totalItems, first, last }) {
  if (!id) throw new Error('buildOrderedCollection: id is required');
  const collection = {
    id,
    type: 'OrderedCollection',
    totalItems: totalItems ?? 0,
  };
  if (first) collection.first = first;
  if (last) collection.last = last;
  return collection;
}

/**
 * Build one page of an OrderedCollection.
 *
 * `items` should already be in the collection's delivery order (newest
 * first, by convention, matching AS2 outbox/inbox ordering).
 */
export function buildOrderedCollectionPage({ id, partOf, items, next, prev }) {
  if (!id) throw new Error('buildOrderedCollectionPage: id is required');
  if (!partOf) throw new Error('buildOrderedCollectionPage: partOf is required');
  const page = {
    id,
    type: 'OrderedCollectionPage',
    partOf,
    orderedItems: items ?? [],
  };
  if (next) page.next = next;
  if (prev) page.prev = prev;
  return page;
}
