import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequest, generateRsaTransportKeypair } from '@qu/ap-core';
import { QuEvents, MemoryStoreAdapter } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { ingestActivity } from '../src/pipeline.js';

const INBOX_URL = 'https://relay.example/actors/bob/inbox';
const SENDER_ID = 'https://sender.example/actors/alice';
const KEY_ID = `${SENDER_ID}#transport-key`;

function makeSignedRequest(activity, { privateKey, keyId = KEY_ID } = {}) {
  const rawBody = JSON.stringify(activity);
  const headers = signRequest({ method: 'POST', url: INBOX_URL, body: rawBody, keyId, privateKey });
  return { activity, rawBody, headers };
}

function makeContext({ actorId = SENDER_ID, publicKey, resolveActorKey } = {}) {
  const events = new QuEvents();
  const store = new ApStore({ adapter: new MemoryStoreAdapter(), events });
  const resolve = resolveActorKey ?? (async () => ({ actor: { id: actorId }, publicKey }));
  return { events, store, resolveActorKey: resolve };
}

test('rejects a non-object body', async () => {
  const { store, events, resolveActorKey } = makeContext({});
  const result = await ingestActivity({
    activity: null,
    rawBody: 'null',
    url: INBOX_URL,
    headers: {},
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });
  assert.deepEqual(result, { ok: false, reason: 'invalid-body' });
});

test('rejects a request with no Signature header', async () => {
  const { store, events, resolveActorKey } = makeContext({});
  const result = await ingestActivity({
    activity: { id: 'x', type: 'Create', actor: SENDER_ID },
    rawBody: '{}',
    url: INBOX_URL,
    headers: {},
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-signature');
});

test('rejects when key resolution fails', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const { activity, rawBody, headers } = makeSignedRequest(
    { id: 'https://sender.example/activities/1', type: 'Create', actor: SENDER_ID },
    { privateKey },
  );
  const { store, events } = makeContext({});
  const result = await ingestActivity({
    activity,
    rawBody,
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey: async () => {
      throw new Error('actor not found');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'key-resolution-failed');
});

test('rejects an invalid signature (wrong key)', async () => {
  const signer = generateRsaTransportKeypair();
  const other = generateRsaTransportKeypair();
  const { activity, rawBody, headers } = makeSignedRequest(
    { id: 'https://sender.example/activities/1', type: 'Create', actor: SENDER_ID },
    { privateKey: signer.privateKey },
  );
  const { store, events, resolveActorKey } = makeContext({ publicKey: other.publicKey });
  const result = await ingestActivity({
    activity,
    rawBody,
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature-invalid');
});

test('rejects an invalid signature (tampered body)', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const { activity, headers } = makeSignedRequest(
    { id: 'https://sender.example/activities/1', type: 'Create', actor: SENDER_ID },
    { privateKey },
  );
  const { store, events, resolveActorKey } = makeContext({ publicKey });
  const result = await ingestActivity({
    activity,
    rawBody: JSON.stringify({ ...activity, actor: 'https://evil.example/actors/mallory' }),
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature-invalid');
});

test('rejects an activity with no actor', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const { activity, rawBody, headers } = makeSignedRequest(
    { id: 'https://sender.example/activities/1', type: 'Create' },
    { privateKey },
  );
  const { store, events, resolveActorKey } = makeContext({ publicKey });
  const result = await ingestActivity({
    activity,
    rawBody,
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-actor');
});

test('rejects an activity whose actor does not match the signer (spoofing)', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const { activity, rawBody, headers } = makeSignedRequest(
    {
      id: 'https://sender.example/activities/1',
      type: 'Create',
      actor: 'https://evil.example/actors/mallory',
    },
    { privateKey },
  );
  const { store, events, resolveActorKey } = makeContext({ publicKey }); // resolves to SENDER_ID
  const result = await ingestActivity({
    activity,
    rawBody,
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'actor-mismatch');
});

test('accepts a validly signed, correctly-attributed activity and persists it', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const activityIn = {
    id: 'https://sender.example/activities/1',
    type: 'Create',
    actor: SENDER_ID,
    object: { id: 'https://sender.example/notes/1', type: 'Note', content: 'hi' },
  };
  const { activity, rawBody, headers } = makeSignedRequest(activityIn, { privateKey });
  const { store, events, resolveActorKey } = makeContext({ publicKey });

  const result = await ingestActivity({
    activity,
    rawBody,
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(await store.get(activityIn.id), activityIn);
  assert.deepEqual(await store.get(activityIn.object.id), activityIn.object);

  const inboxChildren = await store.getChildren(INBOX_URL);
  assert.equal(inboxChildren.length, 1);
  assert.equal(inboxChildren[0].id, activityIn.id);
});

test('fires all pipeline hooks, on the shared events bus, in order', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const activityIn = {
    id: 'https://sender.example/activities/1',
    type: 'Follow',
    actor: SENDER_ID,
    object: SENDER_ID,
  };
  const { activity, rawBody, headers } = makeSignedRequest(activityIn, { privateKey });
  const { store, events, resolveActorKey } = makeContext({ publicKey });

  const seen = [];
  for (const name of [
    'ap-ingest:beforeVerify',
    'ap-ingest:afterVerify',
    'ap-ingest:beforeAuthorize',
    'ap-ingest:afterAuthorize',
    'ap-ingest:beforeSideEffect',
    'ap-ingest:afterPersist',
    'ap-ingest:beforeNotify',
  ]) {
    events.on(name, () => seen.push(name));
  }
  // The shared bus also carries ap-store's own 'change' event.
  events.on('change', () => seen.push('change'));

  await ingestActivity({
    activity,
    rawBody,
    url: INBOX_URL,
    headers,
    targetCollection: INBOX_URL,
    store,
    events,
    resolveActorKey,
  });

  assert.deepEqual(seen, [
    'ap-ingest:beforeVerify',
    'ap-ingest:afterVerify',
    'ap-ingest:beforeAuthorize',
    'ap-ingest:afterAuthorize',
    'ap-ingest:beforeSideEffect',
    'change',
    'ap-ingest:afterPersist',
    'ap-ingest:beforeNotify',
  ]);
});
