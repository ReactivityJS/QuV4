// watch()/watchChildren() — the reactivity primitives packages/ui's
// QuComponents (<qu-view>, <qu-bind>, <qu-list>, <qu-if>) are built on.
// Rebuilt from scratch against ap-store's onChange()/getChildren(), but
// preserving the one behavior that matters for correctness: on every
// notification, re-read through the *full* store pipeline (store.get() /
// store.getChildren()) rather than trusting whatever payload rode along
// on the change event. The event is only ever a "something changed, go
// look" signal.
//
// Both functions accept any object shaped like ApStore (onChange/get or
// onChange/getChildren) — they don't import @qu/ap-store, so packages/ui
// stays decoupled from the concrete store implementation.

/**
 * Watch a single object by id. Invokes `callback(doc)` once immediately
 * with the current value, then again every time it changes (`doc` is null
 * if the object doesn't exist / was deleted).
 *
 * @param {{ onChange(cb: Function): Function, get(id: string): Promise<object|null> }} store
 * @param {string} id
 * @param {(doc: object|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function watch(store, id, callback) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('watch: id must be a non-empty string');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('watch: callback must be a function');
  }

  let generation = 0;
  let disposed = false;

  const reread = () => {
    const myGeneration = ++generation;
    Promise.resolve(store.get(id)).then((doc) => {
      if (disposed || myGeneration !== generation) return; // superseded by a later change
      callback(doc);
    });
  };

  const unsubscribe = store.onChange((event) => {
    if (event.id === id) reread();
  });

  reread();

  return () => {
    disposed = true;
    unsubscribe();
  };
}

/**
 * Watch the members of a collection (e.g. an actor's outbox). Invokes
 * `callback(docs)` once immediately with the current list, then again
 * every time a member is added, removed, or a member itself changes.
 *
 * @param {{ onChange(cb: Function): Function, getChildren(id: string, opts?: object): Promise<object[]> }} store
 * @param {string} collectionId
 * @param {(docs: object[]) => void} callback
 * @param {object} [options] - forwarded to store.getChildren() (e.g. { limit })
 * @returns {() => void} unsubscribe
 */
export function watchChildren(store, collectionId, callback, options) {
  if (typeof collectionId !== 'string' || collectionId.length === 0) {
    throw new TypeError('watchChildren: collectionId must be a non-empty string');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('watchChildren: callback must be a function');
  }

  let generation = 0;
  let disposed = false;

  const reread = () => {
    const myGeneration = ++generation;
    Promise.resolve(store.getChildren(collectionId, options)).then((docs) => {
      if (disposed || myGeneration !== generation) return;
      callback(docs);
    });
  };

  const unsubscribe = store.onChange((event) => {
    if ((event.collections ?? []).includes(collectionId)) reread();
  });

  reread();

  return () => {
    disposed = true;
    unsubscribe();
  };
}
