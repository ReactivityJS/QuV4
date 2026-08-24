// The strongest verification available in this environment for Milestone
// M1 ("real Mastodon interop", per docs/rewrite-plan.md's Verification
// section) without network access to an actual external instance: two
// fully independent, fully-wired relay processes (their own store, their
// own actor, their own HTTP server) federate with each other over real
// HTTP, real WebFinger discovery, and real RSA HTTP Signatures — nothing
// is mocked or injected. If this round-trip holds, the wire protocol
// itself is correct; only compatibility with a specific external
// implementation's quirks remains to be checked against a live instance
// post-deployment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter, QuEvents } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { LocalVault, MemoryVaultAdapter } from '@qu/local-vault';
import { resolveWebFinger, fetchActor, resolveActorPublicKey, signRequest } from '@qu/ap-core';
import { DeliveryQueue, resolveInboxes, deliverActivity } from '@qu/ap-delivery';
import { ensureLocalActor } from '../src/local-actor.js';
import { ActorRegistry } from '../src/registry.js';
import { createApRouter } from '../src/ap-router.js';
import { wireAutoAcceptFollows } from '../src/auto-accept-follows.js';

async function startRelay(username) {
  const vault = new LocalVault(new MemoryVaultAdapter());
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const events = new QuEvents();

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;

  const actorRecord = await ensureLocalActor({ vault, host, username });
  const registry = new ActorRegistry();
  registry.register(actorRecord);

  // A real remote peer resolves keys purely by fetching HTTP over the
  // network; here that's still a real fetch, just routed to whichever of
  // our two in-process relays actually owns that https-labelled host.
  const resolveActorKey = (keyId) =>
    resolveActorPublicKey(keyId, { fetchImpl: crossRelayFetch });

  const handle = createApRouter({ host, registry, store, events, resolveActorKey });
  server.on('request', handle);

  const deliveryQueue = new DeliveryQueue({
    store,
    collectionId: `${actorRecord.actor.id}#delivery-queue`,
    keyId: actorRecord.keyId,
    privateKey: actorRecord.privateKey,
    resolveInboxesImpl: (recipientIds) =>
      resolveInboxes(recipientIds, { fetchActorImpl: (id) => fetchActor(id, { fetchImpl: crossRelayFetch }) }),
    deliverImpl: (activity, opts) => deliverActivity(activity, { ...opts, fetchImpl: signedCrossRelayFetch }),
  });

  return {
    host,
    base: `http://${host}`,
    store,
    events,
    actor: actorRecord.actor,
    deliveryQueue,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

// signedFetch/fetchActor/resolveWebFinger all build `https://<host>/...`
// URLs, matching real AP id conventions; every relay in this test actually
// listens on plain http://127.0.0.1:<port>. This is the one seam that
// exists only because two relays share a process in this test — it does
// not touch anything under test (signing, verification, routing all run
// for real), it only redirects the transport socket.
function crossRelayFetch(url, opts) {
  return fetch(url.replace(/^https:\/\//, 'http://'), opts);
}

// Same seam, for outgoing deliveries: sign for real (the Host header comes
// from the URL's authority, which is identical either way — only the
// scheme differs), then send the request over plain http.
function signedCrossRelayFetch(url, options = {}) {
  const { method = 'GET', headers = {}, body, keyId, privateKey, ...rest } = options;
  const signedHeaders = signRequest({ method, url, headers, body, keyId, privateKey });
  return crossRelayFetch(url, { ...rest, method, headers: signedHeaders, body });
}

test('full self-federation round trip: WebFinger discovery, signed Follow, verified ingest, auto-Accept delivered back', async () => {
  const us = await startRelay('alice');
  const remote = await startRelay('carol');

  try {
    wireAutoAcceptFollows({ events: us.events, store: us.store, deliveryQueue: us.deliveryQueue, actor: us.actor });

    // 1. Remote discovers our actor purely via WebFinger, the way a real
    //    fediverse server would, given only `alice@host`.
    const discoveredActorUrl = await resolveWebFinger(`alice@${us.host}`, { fetchImpl: crossRelayFetch });
    assert.equal(discoveredActorUrl, us.actor.id);

    const discoveredActor = await fetchActor(discoveredActorUrl, { fetchImpl: crossRelayFetch });
    assert.equal(discoveredActor.inbox, us.actor.inbox);

    // 2. Remote sends a real, RSA-signed Follow to our inbox via its own
    //    delivery queue (real HTTP Signature, real network round trip).
    const follow = {
      id: `${remote.actor.id}/activities/1`,
      type: 'Follow',
      actor: remote.actor.id,
      object: us.actor.id,
    };
    await remote.deliveryQueue.enqueue(follow, [us.actor.id]);
    const followDelivery = await remote.deliveryQueue.processDue();
    assert.equal(followDelivery[0]?.ok, true);

    // 3. Our side actually verified the signature against remote's real,
    //    independently-served actor document and persisted the Follow.
    const ourInbox = await us.store.getChildren(us.actor.inbox);
    assert.equal(ourInbox.length, 1);
    assert.equal(ourInbox[0].id, follow.id);

    // 4. Our auto-accept hook fired (on 'ap-ingest:afterPersist') and
    //    queued a real Accept back to remote.
    await sleep(0); // let the async listener run
    const accepted = await us.deliveryQueue.processDue();
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].ok, true);

    // 5. Remote's own store, populated purely by receiving our signed
    //    HTTP request, now holds the Accept — verified against *our*
    //    real actor document, independently of anything we asserted.
    const remoteInbox = await remote.store.getChildren(remote.actor.inbox);
    assert.equal(remoteInbox.length, 1);
    assert.equal(remoteInbox[0].type, 'Accept');
    assert.equal(remoteInbox[0].actor, us.actor.id);
    assert.equal(remoteInbox[0].object, follow.id);
  } finally {
    await us.close();
    await remote.close();
  }
});
