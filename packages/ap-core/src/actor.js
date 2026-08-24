// AS2 Actor document construction. Every Qu actor carries two keys with
// distinct roles (see docs/rewrite-plan.md decision 5):
//   - an Ed25519 Multikey in `assertionMethod`, the real identity key
//     (`qu:proof`, content signing)
//   - a throwaway RSA-2048 key in the classic `publicKey` property, used
//     only for the outer HTTP Signature envelope so Mastodon and other
//     rsa-sha256-only implementations can verify federated deliveries.

import { QU_CONTEXT, ACTOR_TYPES } from '@qu/as2';

/**
 * Build an AS2 Actor document.
 *
 * @param {object} params
 * @param {string} params.id - the actor's dereferenceable AS2 id URL
 * @param {string} [params.type] - one of ACTOR_TYPES, defaults to 'Person'
 * @param {string} [params.preferredUsername]
 * @param {string} [params.name]
 * @param {string} [params.summary]
 * @param {string} params.inbox
 * @param {string} params.outbox
 * @param {string} [params.followers]
 * @param {string} [params.following]
 * @param {string} [params.sharedInbox]
 * @param {string} params.publicKeyMultibase - Ed25519 Multikey string (identity key)
 * @param {string} params.rsaPublicKeyPem - throwaway RSA-2048 transport public key, PEM
 */
export function buildActor({
  id,
  type = 'Person',
  preferredUsername,
  name,
  summary,
  inbox,
  outbox,
  followers,
  following,
  sharedInbox,
  publicKeyMultibase,
  rsaPublicKeyPem,
}) {
  if (!id) throw new Error('buildActor: id is required');
  if (!ACTOR_TYPES.includes(type)) {
    throw new Error(`buildActor: unknown actor type '${type}'`);
  }
  if (!inbox) throw new Error('buildActor: inbox is required');
  if (!outbox) throw new Error('buildActor: outbox is required');
  if (!publicKeyMultibase) throw new Error('buildActor: publicKeyMultibase is required');
  if (!rsaPublicKeyPem) throw new Error('buildActor: rsaPublicKeyPem is required');

  const actor = {
    '@context': QU_CONTEXT,
    id,
    type,
    inbox,
    outbox,
  };

  if (preferredUsername) actor.preferredUsername = preferredUsername;
  if (name) actor.name = name;
  if (summary) actor.summary = summary;
  if (followers) actor.followers = followers;
  if (following) actor.following = following;
  if (sharedInbox) actor.endpoints = { sharedInbox };

  actor.publicKey = {
    id: `${id}#transport-key`,
    owner: id,
    publicKeyPem: rsaPublicKeyPem,
  };

  actor.assertionMethod = [
    {
      id: `${id}#identity-key`,
      type: 'Multikey',
      controller: id,
      publicKeyMultibase,
    },
  ];

  return actor;
}
