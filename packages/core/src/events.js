// QuEvents — the sole internal event bus (see docs/rewrite-plan.md
// decision 4). A small, dependency-free pub/sub implementation (not
// node:events) so it behaves identically in the browser client and on
// QuRelay. Both local reactivity (packages/reactive) and the realtime
// wire channel (packages/ap-realtime, future phase) are fed by this same
// bus — never two parallel notification paths.

export class QuEvents {
  #listeners = new Map(); // event name -> Set<{ fn, once }>

  /** Subscribe to `event`. Returns an unsubscribe function. */
  on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError('QuEvents.on: fn must be a function');
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    const entry = { fn, once: false };
    set.add(entry);
    return () => this.#removeEntry(event, entry);
  }

  /** Subscribe to `event` for a single invocation. Returns an unsubscribe function. */
  once(event, fn) {
    if (typeof fn !== 'function') throw new TypeError('QuEvents.once: fn must be a function');
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    const entry = { fn, once: true };
    set.add(entry);
    return () => this.#removeEntry(event, entry);
  }

  /** Remove a previously registered listener. */
  off(event, fn) {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const entry of set) {
      if (entry.fn === fn) {
        this.#removeEntry(event, entry);
      }
    }
  }

  /** Synchronously invoke every listener registered for `event`. */
  emit(event, ...args) {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot before iterating: a listener may subscribe/unsubscribe
    // during emit, which must not affect this dispatch.
    for (const entry of [...set]) {
      if (entry.once) this.#removeEntry(event, entry);
      entry.fn(...args);
    }
  }

  /** Number of listeners currently registered for `event`. */
  listenerCount(event) {
    return this.#listeners.get(event)?.size ?? 0;
  }

  #removeEntry(event, entry) {
    const set = this.#listeners.get(event);
    if (!set) return;
    set.delete(entry);
    if (set.size === 0) this.#listeners.delete(event);
  }
}
