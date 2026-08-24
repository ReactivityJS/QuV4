// GroupMembership — tracks who's in a group via ap-store, the same single
// storage API everything else uses. Membership records are stored under a
// deliberately-namespaced id (`urn:qu:group-member:...`), never under the
// member's own actor id — ap-store's object namespace is global/flat, so
// reusing a real actor id for a lightweight pointer record would risk
// colliding with that actor's own cached profile object.

import { DURABILITY } from '@qu/as2';

function membershipRecordId(groupId, memberId) {
  return `urn:qu:group-member:${groupId}${memberId}`;
}

export class GroupMembership {
  #store;
  #groupId;
  #membersCollection;

  constructor({ store, groupId }) {
    if (!store) throw new Error('GroupMembership: store is required');
    if (!groupId) throw new Error('GroupMembership: groupId is required');
    this.#store = store;
    this.#groupId = groupId;
    this.#membersCollection = `${groupId}/members`;
  }

  get membersCollection() {
    return this.#membersCollection;
  }

  /** Record `memberId` as a member (the effect of processing an Accept). */
  async addMember(memberId, { joinedAt = Date.now() } = {}) {
    const id = membershipRecordId(this.#groupId, memberId);
    await this.#store.put(
      { id, groupId: this.#groupId, memberId, joinedAt },
      { collections: [this.#membersCollection], durability: DURABILITY.PERSISTENT, ts: joinedAt },
    );
  }

  /** Revoke membership (a Leave or a Remove). */
  async removeMember(memberId) {
    await this.#store.delete(membershipRecordId(this.#groupId, memberId));
  }

  async isMember(memberId) {
    return (await this.#store.get(membershipRecordId(this.#groupId, memberId))) !== null;
  }

  /** All current member ids. */
  async listMembers({ limit = 1000 } = {}) {
    const entries = await this.#store.getChildren(this.#membersCollection, { limit });
    return entries.map((e) => e.memberId);
  }
}
