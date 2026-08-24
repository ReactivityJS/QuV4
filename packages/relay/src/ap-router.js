// ap-router.js — QuRelay's AP-server role: the standard federation routes
// (WebFinger, NodeInfo, Actor, Inbox, Outbox, Followers/Following,
// sharedInbox). Deliberately built on plain node:http rather than a
// framework, so the "hook, don't fork" extensibility the rewrite plan
// asks for (see docs/rewrite-plan.md § AP-Server-Unterbau) comes entirely
// from the shared QuEvents bus ap-ingest already emits on — this router
// adds no second extension mechanism.
//
// http-router.js (the QuServer role — PWA hosting, push routing) is
// future work; this file only ever plays the AP-server half of QuRelay.

import { parseAcct, buildWebFingerResource, buildNodeInfo, buildNodeInfoDiscovery, buildOrderedCollectionPage } from '@qu/ap-core';
import { normalizeAudience } from '@qu/as2';
import { ingestActivity } from '@qu/ap-ingest';

function sendJson(res, status, body, contentType = 'application/activity+json') {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': contentType });
  res.end(payload);
}

function sendStatus(res, status) {
  res.writeHead(status);
  res.end();
}

function idOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

// Explicit `to`/`cc`/`audience` addressing covers most activity types
// (Create, Announce, ...), but some — Follow chief among them — carry
// their real recipient in `object` instead, often with no addressing
// fields at all. This is how Mastodon and other real implementations
// route Follow deliveries, so sharedInbox routing has to check both.
function recipientCandidates(activity) {
  const candidates = [...normalizeAudience(activity).recipients];
  const objectId = idOf(activity.object);
  if (objectId) candidates.push(objectId);
  return candidates;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const INGEST_FAILURE_STATUS = {
  'invalid-body': 400,
  'missing-signature': 401,
  'key-resolution-failed': 401,
  'signature-invalid': 401,
  'missing-actor': 400,
  'actor-mismatch': 403,
};

function statusForIngestFailure(reason) {
  return INGEST_FAILURE_STATUS[reason] ?? 400;
}

/**
 * @param {object} params
 * @param {string} params.host - public hostname (used to build absolute URLs/request-target for signature verification)
 * @param {import('./registry.js').ActorRegistry} params.registry
 * @param {{ getChildren: Function }} params.store
 * @param {import('@qu/core').QuEvents} params.events
 * @param {Function} params.resolveActorKey - injectable, forwarded to ingestActivity()
 * @param {{ name: string, version: string }} [params.software] - for NodeInfo
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createApRouter({ host, registry, store, events, resolveActorKey, software = { name: 'quniverse', version: '0.0.0' } }) {
  if (!host) throw new Error('createApRouter: host is required');
  if (!registry) throw new Error('createApRouter: registry is required');
  if (!store) throw new Error('createApRouter: store is required');
  if (!events) throw new Error('createApRouter: events is required');

  async function handleWebFinger(url, res) {
    const resource = url.searchParams.get('resource');
    const parsed = resource ? parseAcct(resource) : null;
    if (!parsed) return sendStatus(res, 400);
    const record = registry.byUsername(parsed.username);
    if (!record) return sendStatus(res, 404);
    const jrd = buildWebFingerResource({ username: parsed.username, host: parsed.host, actorUrl: record.actor.id });
    return sendJson(res, 200, jrd, 'application/jrd+json');
  }

  async function handleCollectionGet(res, collectionId) {
    if (!collectionId) return sendStatus(res, 404);
    const items = await store.getChildren(collectionId, { limit: 20 });
    const page = buildOrderedCollectionPage({ id: collectionId, partOf: collectionId, items });
    return sendJson(res, 200, page);
  }

  async function runIngest(req, res, requestUrl, activity, rawBody, targetCollection) {
    const result = await ingestActivity({
      activity,
      rawBody,
      method: 'POST',
      url: requestUrl,
      headers: req.headers,
      targetCollection,
      store,
      events,
      resolveActorKey,
    });
    if (result.ok) return sendStatus(res, 202);
    return sendStatus(res, statusForIngestFailure(result.reason));
  }

  async function handleInboxPost(req, res, requestUrl, record) {
    const rawBody = await readBody(req);
    let activity;
    try {
      activity = JSON.parse(rawBody);
    } catch {
      return sendStatus(res, 400);
    }
    return runIngest(req, res, requestUrl, activity, rawBody, record.actor.inbox);
  }

  async function handleSharedInboxPost(req, res, requestUrl) {
    const rawBody = await readBody(req);
    let activity;
    try {
      activity = JSON.parse(rawBody);
    } catch {
      return sendStatus(res, 400);
    }
    const target = recipientCandidates(activity)
      .map((id) => registry.byId(id))
      .find(Boolean);
    if (!target) return sendStatus(res, 400);
    return runIngest(req, res, requestUrl, activity, rawBody, target.actor.inbox);
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, `https://${host}`);
      const requestUrl = `https://${host}${req.url}`;

      if (req.method === 'GET' && url.pathname === '/.well-known/webfinger') {
        return await handleWebFinger(url, res);
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/nodeinfo') {
        return sendJson(res, 200, buildNodeInfoDiscovery(`https://${host}/nodeinfo/2.1`), 'application/jrd+json');
      }
      if (req.method === 'GET' && url.pathname === '/nodeinfo/2.1') {
        return sendJson(res, 200, buildNodeInfo({ softwareName: software.name, softwareVersion: software.version }), 'application/json');
      }
      if (req.method === 'POST' && url.pathname === '/inbox') {
        return await handleSharedInboxPost(req, res, requestUrl);
      }

      const actorMatch = /^\/actors\/([^/]+)(?:\/(inbox|outbox|followers|following))?$/.exec(url.pathname);
      if (actorMatch) {
        const [, username, sub] = actorMatch;
        const record = registry.byUsername(username);
        if (!record) return sendStatus(res, 404);

        if (!sub && req.method === 'GET') return sendJson(res, 200, record.actor);
        if (sub === 'inbox' && req.method === 'POST') return await handleInboxPost(req, res, requestUrl, record);
        if (sub === 'outbox' && req.method === 'GET') return await handleCollectionGet(res, record.actor.outbox);
        if (sub === 'followers' && req.method === 'GET') return await handleCollectionGet(res, record.actor.followers);
        if (sub === 'following' && req.method === 'GET') return await handleCollectionGet(res, record.actor.following);
      }

      return sendStatus(res, 404);
    } catch (err) {
      events.emit('ap-router:error', { error: err, url: req.url, method: req.method });
      return sendStatus(res, 500);
    }
  };
}
