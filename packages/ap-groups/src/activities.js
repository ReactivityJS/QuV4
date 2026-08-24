// Join/Accept/Leave/Remove — the standard AS2 activity types (AS2 core
// vocabulary §5.5) this package uses for group membership, exactly as
// docs/rewrite-plan.md calls for ("Join/Accept-Mechanismus wie jede andere
// Gruppe"). No `qu:`-namespaced membership activity is needed — AS2
// already has these.

import { mintId } from '@qu/as2';

/** A member-to-be requests to join `groupId`. */
export function buildJoinActivity({ actorBase, actorId, groupId }) {
  return { id: mintId({ actorBase, collection: 'activities' }), type: 'Join', actor: actorId, object: groupId };
}

/** The group (or an existing member acting for it) approves a Join. */
export function buildAcceptActivity({ actorBase, groupId, joinActivity }) {
  return {
    id: mintId({ actorBase, collection: 'activities' }),
    type: 'Accept',
    actor: groupId,
    object: joinActivity.id,
  };
}

/** A member leaves `groupId` of their own accord. */
export function buildLeaveActivity({ actorBase, actorId, groupId }) {
  return { id: mintId({ actorBase, collection: 'activities' }), type: 'Leave', actor: actorId, object: groupId };
}

/** The group removes `memberId` (revocation — e.g. a lost device). */
export function buildRemoveActivity({ actorBase, groupId, memberId }) {
  return {
    id: mintId({ actorBase, collection: 'activities' }),
    type: 'Remove',
    actor: groupId,
    object: memberId,
    target: groupId,
  };
}
