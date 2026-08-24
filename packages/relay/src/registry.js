// In-memory registry of locally-hosted actors, keyed both by username
// (for WebFinger/actor-path routing) and by full actor id (for resolving
// which local actor a sharedInbox delivery is addressed to). One relay
// process can host more than one local actor even though local-actor.js
// itself only bootstraps one at a time from a single vault.

export class ActorRegistry {
  #byUsername = new Map();
  #byId = new Map();

  /** @param {{ actor: object, username: string }} record - as returned by ensureLocalActor() */
  register(record) {
    this.#byUsername.set(record.username, record);
    this.#byId.set(record.actor.id, record);
  }

  byUsername(username) {
    return this.#byUsername.get(username);
  }

  byId(id) {
    return this.#byId.get(id);
  }
}
