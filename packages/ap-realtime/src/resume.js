// qu:Resume{since} replay: the server-side half of lossless reconnect.
// Given a peer's per-collection "since" cursors, replays every persisted
// entry it missed (oldest first) as ordinary data frames, then a single
// 'resumed' control frame carrying the cursors to remember for next time.
// ap-client applies each replayed frame the same way it applies a live
// one — see docs/rewrite-plan.md's rule that reads always go through the
// full pipeline, never trust a raw payload shortcut.

import { DURABILITY } from '@qu/as2';
import { buildDataFrame, buildControlFrame, CONTROL_OP } from './frame.js';

/**
 * @param {object} params
 * @param {{ getChildrenSince: Function }} params.store
 * @param {string[]} params.subscriptions - collection ids the peer is subscribed to
 * @param {Record<string, string|null>} [params.since] - last-seen cursor per collection id
 * @param {(frame: object) => void} params.send
 * @returns {Promise<Record<string, string|null>>} the cursors to remember for the next resume
 */
export async function replayResume({ store, subscriptions, since = {}, send }) {
  const cursors = {};

  for (const collectionId of subscriptions) {
    const sinceCursor = since[collectionId] ?? null;
    const entries = await store.getChildrenSince(collectionId, sinceCursor, { limit: Infinity });

    for (const { doc, cursor } of entries) {
      // Attach the cursor getChildrenSince() already computed directly,
      // rather than passing `ts` through and having buildDataFrame()
      // re-derive it — same encoding, one less recomputation.
      const frame = buildDataFrame({
        id: doc.id,
        doc,
        collections: [collectionId],
        durability: DURABILITY.PERSISTENT,
      });
      frame.cursor = cursor;
      send(frame);
      cursors[collectionId] = cursor;
    }

    if (!(collectionId in cursors)) cursors[collectionId] = sinceCursor;
  }

  send(buildControlFrame(CONTROL_OP.RESUMED, { cursors }));
  return cursors;
}
