// A small, optional example of the hook-based extensibility the AP-server
// is built for (docs/rewrite-plan.md § AP-Server-Unterbau): auto-accepting
// Follow requests is *not* baked into ap-ingest itself — it's app/relay
// policy, wired on the shared QuEvents bus via 'ap-ingest:afterPersist',
// exactly the way a moderation hook or a Lemmy-compatibility shim would
// be. A relay that wants manual follow approval simply doesn't call this.

import { mintId, DURABILITY } from '@qu/as2';

function idOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

/**
 * @param {object} params
 * @param {import('@qu/core').QuEvents} params.events - the shared bus ap-ingest emits hooks on
 * @param {{ put: Function }} params.store
 * @param {{ enqueue: Function }} params.deliveryQueue
 * @param {object} params.actor - the local actor's AS2 document (must have id and outbox)
 * @returns {() => void} unsubscribe
 */
export function wireAutoAcceptFollows({ events, store, deliveryQueue, actor }) {
  if (!actor?.id || !actor?.outbox) {
    throw new Error('wireAutoAcceptFollows: actor.id and actor.outbox are required');
  }

  return events.on('ap-ingest:afterPersist', async ({ activity }) => {
    if (activity.type !== 'Follow') return;
    if (idOf(activity.object) !== actor.id) return;

    const followerId = idOf(activity.actor);
    if (!followerId) return;

    const accept = {
      id: mintId({ actorBase: actor.id, collection: 'activities' }),
      type: 'Accept',
      actor: actor.id,
      object: activity.id,
      to: [followerId],
    };

    await store.put(accept, { collections: [actor.outbox], durability: DURABILITY.PERSISTENT });
    await deliveryQueue.enqueue(accept, [followerId]);
  });
}
