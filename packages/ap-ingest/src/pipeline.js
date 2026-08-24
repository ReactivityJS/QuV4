// ap-ingest: verify -> authorize -> side-effect -> persist -> notify.
// The one pipeline every incoming activity goes through, for Class B
// (private, cross-device — e.g. a settings update from another of your
// own devices) exactly as much as Class C (federated/social) — see
// docs/rewrite-plan.md § ACL/Audience.
//
// Every step is bracketed by a QuEvents hook (beforeVerify/afterVerify/
// beforeAuthorize/afterAuthorize/beforeSideEffect/afterPersist/
// beforeNotify — see the "Ergänzung" section on AP-Server-Unterbau) so
// moderation, Lemmy/Pixelfed-compatibility shims, or CMS-render triggers
// can hook in without ap-ingest itself changing. Pass the *same* QuEvents
// instance the ApStore was constructed with — there is exactly one event
// bus in the system, not one per package.

import { extractKeyId, resolveActorPublicKey, verifyRequest } from '@qu/ap-core';
import { DURABILITY } from '@qu/as2';

function idOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function failure(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

/**
 * Ingest one incoming activity delivered to an inbox.
 *
 * @param {object} params
 * @param {object} params.activity - the parsed AS2 activity body
 * @param {string} params.rawBody - the exact raw request body (for Digest/Signature verification)
 * @param {string} [params.method] - default 'POST'
 * @param {string} params.url - the full URL the request was made to (the inbox URL)
 * @param {object} params.headers - request headers, lowercase keys, must include 'signature'
 * @param {string} params.targetCollection - the inbox collection id to index this activity under
 * @param {{ put: Function }} params.store - an ApStore (or duck-typed equivalent)
 * @param {import('@qu/core').QuEvents} params.events - the shared QuEvents bus
 * @param {Function} [params.resolveActorKey] - injectable, default resolveActorPublicKey from @qu/ap-core
 * @returns {Promise<{ ok: true, activity: object } | { ok: false, reason: string }>}
 */
export async function ingestActivity({
  activity,
  rawBody,
  method = 'POST',
  url,
  headers,
  targetCollection,
  store,
  events,
  resolveActorKey = resolveActorPublicKey,
}) {
  if (!activity || typeof activity !== 'object') {
    return failure('invalid-body');
  }

  events.emit('ap-ingest:beforeVerify', { activity, headers });

  const keyId = extractKeyId(headers?.signature);
  if (!keyId) {
    return failure('missing-signature');
  }

  let actor;
  let publicKey;
  try {
    ({ actor, publicKey } = await resolveActorKey(keyId));
  } catch (err) {
    return failure('key-resolution-failed', { message: err.message });
  }

  const verified = verifyRequest({ method, url, headers, body: rawBody, publicKey });
  if (!verified) {
    return failure('signature-invalid');
  }

  events.emit('ap-ingest:afterVerify', { activity, actor });

  events.emit('ap-ingest:beforeAuthorize', { activity, actor });

  const activityActorId = idOf(activity.actor);
  if (!activityActorId) {
    return failure('missing-actor');
  }
  // The activity must be asserted by the same actor that signed the
  // request — otherwise anyone could forge an activity "from" someone
  // else and have it accepted as long as *they* could sign a request.
  if (activityActorId !== actor.id) {
    return failure('actor-mismatch');
  }

  events.emit('ap-ingest:afterAuthorize', { activity, actor });

  events.emit('ap-ingest:beforeSideEffect', { activity, actor });

  const ts = Date.now();
  await store.put(activity, {
    collections: [targetCollection],
    durability: DURABILITY.PERSISTENT,
    ts,
  });

  // Common AP interop shape: Create wraps an embedded object. Persist the
  // object too (retrievable by its own id) alongside the activity itself.
  if (activity.type === 'Create' && activity.object && typeof activity.object === 'object') {
    await store.put(activity.object, { durability: DURABILITY.PERSISTENT, ts });
  }

  events.emit('ap-ingest:afterPersist', { activity, actor, targetCollection });

  events.emit('ap-ingest:beforeNotify', { activity, actor, targetCollection });

  return { ok: true, activity };
}
