// A Group is structurally just an AS2 Actor with type: 'Group' — see
// docs/rewrite-plan.md's "ein einziger Mechanismus (Group + Audience +
// Encryption)" principle: private chat groups, game groups, and the
// personal "my devices" group (§ personal-devices.js) all use exactly this
// same actor shape, distinguished only by their addressing and encryption
// requirements, never by a special-cased code path.

import { buildActor } from '@qu/ap-core';

/**
 * Build a Group actor document. Same required shape as any other actor
 * (identity Multikey + RSA transport key) — a Group can author its own
 * activities (e.g. announcing new members), so it needs its own keys.
 * Membership is tracked via `followers` (who has an accepted Join) — see
 * membership.js.
 */
export function buildGroupActor(params) {
  return buildActor({ ...params, type: 'Group' });
}
