// AS2 (ActivityStreams 2.0) vocabulary constants, plus Qu's `qu:` extension
// namespace. See docs/rewrite-plan.md for what each `qu:` term is for.

export const AS2_CONTEXT = 'https://www.w3.org/ns/activitystreams';
export const SECURITY_CONTEXT = 'https://w3id.org/security/v1';
export const QU_NAMESPACE = 'https://qu.dev/ns#';

// The JSON-LD @context every Qu-produced AS2 document carries. Keeps the
// `qu:` extension terms resolvable without a network fetch.
export const QU_CONTEXT = Object.freeze([
  AS2_CONTEXT,
  SECURITY_CONTEXT,
  {
    qu: QU_NAMESPACE,
    // Data-locality / durability extensions AS2 has no native vocabulary for.
    federate: 'qu:federate',
    encrypted: 'qu:encrypted',
    encryptedPayload: 'qu:encryptedPayload',
    durability: 'qu:durability',
    session: 'qu:session',
    proof: 'qu:proof',
  },
]);

// Actor types (AS2 core vocabulary).
export const ACTOR_TYPES = Object.freeze([
  'Application',
  'Group',
  'Organization',
  'Person',
  'Service',
]);

// Activity types commonly needed across the plan's phases.
export const ACTIVITY_TYPES = Object.freeze([
  'Accept',
  'Add',
  'Announce',
  'Block',
  'Create',
  'Delete',
  'Follow',
  'Ignore',
  'Join',
  'Leave',
  'Like',
  'Move',
  'Reject',
  'Remove',
  'Undo',
  'Update',
  'View',
]);

// Object types commonly needed across the plan's phases.
export const OBJECT_TYPES = Object.freeze([
  'Article',
  'Collection',
  'CollectionPage',
  'Event',
  'Image',
  'Note',
  'OrderedCollection',
  'OrderedCollectionPage',
  'Page',
  'Place',
  'Question',
  'Tombstone',
]);

// Public audience marker per the AS2 spec (§ 5.6 Public Addressing).
export const PUBLIC_AUDIENCE = 'https://www.w3.org/ns/activitystreams#Public';

// Qu-specific durability tiers (see docs/rewrite-plan.md § Event-Durability-Stufen).
export const DURABILITY = Object.freeze({
  EPHEMERAL: 'ephemeral',
  SESSION: 'session',
  PERSISTENT: 'persistent',
});

export const DURABILITY_TIERS = Object.freeze(Object.values(DURABILITY));

// Qu-specific data-locality classes (see docs/rewrite-plan.md § Datenlokalitäts-Klassen).
// Class A never reaches ap-store at all, so it has no wire representation.
export const LOCALITY = Object.freeze({
  PRIVATE_DEVICE_SYNC: 'B',
  FEDERATED: 'C',
});

export function isDurabilityTier(value) {
  return DURABILITY_TIERS.includes(value);
}
