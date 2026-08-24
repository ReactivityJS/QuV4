// The personal "my devices" group (docs/rewrite-plan.md § Datenlokalitäts-
// Klassen, Klasse B): every identity implicitly has its own,
// not-publicly-discoverable Group whose members are that person's own
// devices, used to address Class B (private, cross-device) data.
//
// Structurally it is nothing but an ordinary Group (see group-actor.js) +
// GroupMembership (see membership.js) — the plan's whole point is that one
// mechanism covers social groups AND this. What this file adds is just the
// naming convention for computing its id.
//
// Honest scope note: a *device* here still means "an identity" in QuV4's
// current model — packages/identity's HD multi-device derivation and the
// QR-code pairing flow the plan describes are not built yet (see README.md
// "Known gaps"). The plan's own risk section explicitly sanctions this:
// "MVP kann vorübergehend mit 'gleicher Seed auf jedem Gerät' starten,
// sofern das dem Nutzer explizit als Übergangslösung kommuniziert wird."
// So today, `GroupMembership` here can track distinct member ids the
// moment distinct device identities exist, but there is no pairing UX
// yet to populate it with more than one — that's real future product
// work, not a gap papered over here.

/** The id of `actorId`'s personal devices group. Never advertised/linked publicly. */
export function personalDevicesGroupId(actorId) {
  if (!actorId) throw new Error('personalDevicesGroupId: actorId is required');
  return `${actorId}/devices`;
}
