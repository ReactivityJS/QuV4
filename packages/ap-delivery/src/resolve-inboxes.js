// Audience -> inbox resolution. Turns a list of recipient actor ids into
// the set of inbox URLs to actually POST to, preferring each actor's
// `endpoints.sharedInbox` (so N recipients on the same remote server
// collapse into one delivery) and falling back to their personal inbox.

import { fetchActor } from '@qu/ap-core';

/**
 * @param {string[]} recipientIds - actor ids (the public audience marker, if present, should already be excluded by the caller)
 * @param {object} [options]
 * @param {Function} [options.fetchActorImpl] - injectable, default fetchActor from @qu/ap-core
 * @returns {Promise<{ inboxes: string[], errors: { id: string, message: string }[] }>}
 */
export async function resolveInboxes(recipientIds, { fetchActorImpl = fetchActor } = {}) {
  const inboxes = new Set();
  const errors = [];

  for (const id of recipientIds) {
    try {
      const actor = await fetchActorImpl(id);
      inboxes.add(actor.endpoints?.sharedInbox ?? actor.inbox);
    } catch (err) {
      errors.push({ id, message: err.message });
    }
  }

  return { inboxes: [...inboxes], errors };
}
