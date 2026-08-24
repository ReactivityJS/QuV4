// Network-side actor/WebFinger resolution — the "ap-core Serverseite"
// half of federation: given a handle or actor URL, fetch and parse enough
// to verify a signature or find a delivery inbox. Used by ap-ingest
// (resolve the sender's key) and ap-delivery (resolve a recipient's
// inbox). Uses the platform global `fetch`, not signedFetch — resolving
// an actor is itself an unauthenticated GET in AP.

import { createPublicKey } from 'node:crypto';
import { parseAcct, buildWebFingerRequestUrl, actorUrlFromWebFinger } from './webfinger.js';

const ACTIVITY_JSON_ACCEPT =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';

/** Resolve `user@host` (or `acct:user@host`) to an actor URL via WebFinger. */
export async function resolveWebFinger(handle, { fetchImpl = fetch } = {}) {
  const acct = handle.startsWith('acct:') ? handle : `acct:${handle}`;
  const parsed = parseAcct(acct);
  if (!parsed) throw new Error(`resolveWebFinger: malformed handle '${handle}'`);

  const url = buildWebFingerRequestUrl(parsed.host, parsed.username);
  const response = await fetchImpl(url, { headers: { accept: 'application/jrd+json' } });
  if (!response.ok) {
    throw new Error(`resolveWebFinger: ${url} responded ${response.status}`);
  }
  const jrd = await response.json();
  const actorUrl = actorUrlFromWebFinger(jrd);
  if (!actorUrl) {
    throw new Error(`resolveWebFinger: no self/activity+json link for '${handle}'`);
  }
  return actorUrl;
}

/** Fetch and minimally validate an AS2 Actor document. */
export async function fetchActor(actorUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(actorUrl, { headers: { accept: ACTIVITY_JSON_ACCEPT } });
  if (!response.ok) {
    throw new Error(`fetchActor: ${actorUrl} responded ${response.status}`);
  }
  const actor = await response.json();
  if (typeof actor.id !== 'string' || typeof actor.inbox !== 'string') {
    throw new Error(`fetchActor: ${actorUrl} did not return a valid actor document`);
  }
  return actor;
}

/**
 * Fetch an actor and return its transport (RSA) public key ready to verify
 * an HTTP Signature against, matched by `keyId` (the Signature header's
 * keyId, normally `${actorId}#transport-key`).
 */
export async function resolveActorPublicKey(keyId, { fetchImpl = fetch } = {}) {
  const actorUrl = keyId.split('#')[0];
  const actor = await fetchActor(actorUrl, { fetchImpl });
  if (!actor.publicKey || actor.publicKey.id !== keyId) {
    throw new Error(`resolveActorPublicKey: ${actorUrl} has no publicKey matching '${keyId}'`);
  }
  return {
    actor,
    publicKey: createPublicKey(actor.publicKey.publicKeyPem),
  };
}
