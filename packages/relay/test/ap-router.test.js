import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { MemoryStoreAdapter, QuEvents } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { LocalVault, MemoryVaultAdapter } from '@qu/local-vault';
import { signRequest, generateRsaTransportKeypair } from '@qu/ap-core';
import { ensureLocalActor } from '../src/local-actor.js';
import { ActorRegistry } from '../src/registry.js';
import { createApRouter } from '../src/ap-router.js';

const REMOTE_ACTOR_ID = 'https://sender.example/actors/carol';
const REMOTE_KEY_ID = `${REMOTE_ACTOR_ID}#transport-key`;

async function withRelay(run) {
  const vault = new LocalVault(new MemoryVaultAdapter());
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const events = new QuEvents();
  const remote = generateRsaTransportKeypair();

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;

  const alice = await ensureLocalActor({ vault, host, username: 'alice' });
  const registry = new ActorRegistry();
  registry.register(alice);

  const resolveActorKey = async (keyId) => {
    if (keyId === REMOTE_KEY_ID) return { actor: { id: REMOTE_ACTOR_ID }, publicKey: remote.publicKey };
    throw new Error(`unknown keyId: ${keyId}`);
  };

  const handle = createApRouter({ host, registry, store, events, resolveActorKey });
  server.on('request', handle);

  try {
    await run({ base: `http://${host}`, host, store, events, alice, registry, remote });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function signedInboxHeaders({ url, body, privateKey, keyId = REMOTE_KEY_ID }) {
  return signRequest({ method: 'POST', url, body, keyId, privateKey });
}

test('GET /.well-known/webfinger resolves a known handle', async () => {
  await withRelay(async ({ base, host }) => {
    const res = await fetch(`${base}/.well-known/webfinger?resource=${encodeURIComponent(`acct:alice@${host}`)}`);
    assert.equal(res.status, 200);
    const jrd = await res.json();
    assert.equal(jrd.subject, `acct:alice@${host}`);
  });
});

test('GET /.well-known/webfinger 404s for an unknown user', async () => {
  await withRelay(async ({ base, host }) => {
    const res = await fetch(`${base}/.well-known/webfinger?resource=${encodeURIComponent(`acct:nobody@${host}`)}`);
    assert.equal(res.status, 404);
  });
});

test('GET /.well-known/webfinger 400s without a resource param', async () => {
  await withRelay(async ({ base }) => {
    const res = await fetch(`${base}/.well-known/webfinger`);
    assert.equal(res.status, 400);
  });
});

test('NodeInfo discovery and document are both served', async () => {
  await withRelay(async ({ base, host }) => {
    const discovery = await (await fetch(`${base}/.well-known/nodeinfo`)).json();
    assert.equal(discovery.links[0].href, `https://${host}/nodeinfo/2.1`);
    const info = await (await fetch(`${base}/nodeinfo/2.1`)).json();
    assert.equal(info.software.name, 'quniverse');
  });
});

test('GET /actors/:username returns the actor document', async () => {
  await withRelay(async ({ base, alice }) => {
    const res = await fetch(`${base}/actors/alice`);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.equal(doc.id, alice.actor.id);
  });
});

test('GET /actors/:username 404s for an unknown actor', async () => {
  await withRelay(async ({ base }) => {
    const res = await fetch(`${base}/actors/nobody`);
    assert.equal(res.status, 404);
  });
});

test('GET /actors/:username/outbox returns an OrderedCollectionPage, initially empty', async () => {
  await withRelay(async ({ base, alice }) => {
    const res = await fetch(`${base}/actors/alice/outbox`);
    assert.equal(res.status, 200);
    const page = await res.json();
    assert.equal(page.type, 'OrderedCollectionPage');
    assert.deepEqual(page.orderedItems, []);
    assert.equal(page.partOf, alice.actor.outbox);
  });
});

test('POST /actors/:username/inbox accepts a validly signed activity and persists it', async () => {
  await withRelay(async ({ base, alice, store, remote }) => {
    const activity = { id: 'https://sender.example/activities/1', type: 'Follow', actor: REMOTE_ACTOR_ID, object: alice.actor.id };
    const url = `${base}/actors/alice/inbox`;
    const body = JSON.stringify(activity);
    const headers = signedInboxHeaders({ url, body, privateKey: remote.privateKey });

    const res = await fetch(url, { method: 'POST', headers, body });
    assert.equal(res.status, 202);

    const inboxItems = await store.getChildren(alice.actor.inbox);
    assert.equal(inboxItems.length, 1);
    assert.equal(inboxItems[0].id, activity.id);
  });
});

test('POST /actors/:username/inbox rejects a signature from an unknown key', async () => {
  await withRelay(async ({ base }) => {
    const bogus = generateRsaTransportKeypair();
    const activity = { id: 'https://sender.example/activities/2', type: 'Follow' };
    const url = `${base}/actors/alice/inbox`;
    const body = JSON.stringify(activity);
    const headers = signRequest({ method: 'POST', url, body, keyId: 'https://unknown.example/actors/x#transport-key', privateKey: bogus.privateKey });

    const res = await fetch(url, { method: 'POST', headers, body });
    assert.equal(res.status, 401);
  });
});

test('POST /actors/:username/inbox 400s on unparsable JSON', async () => {
  await withRelay(async ({ base }) => {
    const res = await fetch(`${base}/actors/alice/inbox`, { method: 'POST', body: 'not json' });
    assert.equal(res.status, 400);
  });
});

test('POST /inbox (sharedInbox) routes to the matching local recipient', async () => {
  await withRelay(async ({ base, alice, store, remote }) => {
    const activity = {
      id: 'https://sender.example/activities/3',
      type: 'Create',
      actor: REMOTE_ACTOR_ID,
      to: [alice.actor.id],
      object: { id: 'https://sender.example/notes/1', type: 'Note', content: 'hi alice' },
    };
    const url = `${base}/inbox`;
    const body = JSON.stringify(activity);
    const headers = signedInboxHeaders({ url, body, privateKey: remote.privateKey });

    const res = await fetch(url, { method: 'POST', headers, body });
    assert.equal(res.status, 202);

    const inboxItems = await store.getChildren(alice.actor.inbox);
    assert.equal(inboxItems.length, 1);
    assert.deepEqual(await store.get(activity.object.id), activity.object);
  });
});

test('POST /inbox (sharedInbox) routes a Follow via its object, with no explicit addressing', async () => {
  await withRelay(async ({ base, alice, store, remote }) => {
    // Real Follow activities (Mastodon included) typically carry no
    // to/cc/audience at all — the target is implied by `object`.
    const follow = { id: 'https://sender.example/activities/5', type: 'Follow', actor: REMOTE_ACTOR_ID, object: alice.actor.id };
    const url = `${base}/inbox`;
    const body = JSON.stringify(follow);
    const headers = signedInboxHeaders({ url, body, privateKey: remote.privateKey });

    const res = await fetch(url, { method: 'POST', headers, body });
    assert.equal(res.status, 202);

    const inboxItems = await store.getChildren(alice.actor.inbox);
    assert.equal(inboxItems.length, 1);
    assert.equal(inboxItems[0].id, follow.id);
  });
});

test('POST /inbox (sharedInbox) 400s when no addressed recipient is local', async () => {
  await withRelay(async ({ base, remote }) => {
    const activity = {
      id: 'https://sender.example/activities/4',
      type: 'Create',
      actor: REMOTE_ACTOR_ID,
      to: ['https://elsewhere.example/actors/nobody-local'],
    };
    const url = `${base}/inbox`;
    const body = JSON.stringify(activity);
    const headers = signedInboxHeaders({ url, body, privateKey: remote.privateKey });

    const res = await fetch(url, { method: 'POST', headers, body });
    assert.equal(res.status, 400);
  });
});

test('unknown routes 404', async () => {
  await withRelay(async ({ base }) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});
