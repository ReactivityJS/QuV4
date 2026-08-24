import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolveWebFinger, fetchActor, resolveActorPublicKey } from '../src/resolve.js';
import { buildActor } from '../src/actor.js';
import { buildWebFingerResource } from '../src/webfinger.js';
import { generateEd25519Keypair, generateRsaTransportKeypair } from '../src/multikey.js';

async function withRemoteInstance(run) {
  const ed = generateEd25519Keypair();
  const rsa = generateRsaTransportKeypair();
  let base;
  const actor = () =>
    buildActor({
      id: `${base}/actors/alice`,
      preferredUsername: 'alice',
      inbox: `${base}/actors/alice/inbox`,
      outbox: `${base}/actors/alice/outbox`,
      publicKeyMultibase: ed.publicKeyMultibase,
      rsaPublicKeyPem: rsa.publicKeyPem,
    });

  const server = createServer((req, res) => {
    if (req.url.startsWith('/.well-known/webfinger')) {
      const resource = new URL(req.url, base).searchParams.get('resource');
      if (resource !== `acct:alice@${new URL(base).host}`) {
        res.writeHead(404);
        res.end();
        return;
      }
      const jrd = buildWebFingerResource({
        username: 'alice',
        host: new URL(base).host,
        actorUrl: `${base}/actors/alice`,
      });
      res.writeHead(200, { 'content-type': 'application/jrd+json' });
      res.end(JSON.stringify(jrd));
      return;
    }
    if (req.url === '/actors/alice') {
      res.writeHead(200, { 'content-type': 'application/activity+json' });
      res.end(JSON.stringify(actor()));
      return;
    }
    if (req.url === '/actors/missing-inbox') {
      res.writeHead(200, { 'content-type': 'application/activity+json' });
      res.end(JSON.stringify({ id: `${base}/actors/missing-inbox`, type: 'Person' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, rsa, actor });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('resolveWebFinger resolves a handle to the actor URL', async () => {
  await withRemoteInstance(async ({ base }) => {
    const host = new URL(base).host;
    const actorUrl = await resolveWebFinger(`alice@${host}`, {
      fetchImpl: (url, opts) => fetch(url.replace(`https://${host}`, base), opts),
    });
    assert.equal(actorUrl, `${base}/actors/alice`);
  });
});

test('resolveWebFinger accepts an explicit acct: prefix', async () => {
  await withRemoteInstance(async ({ base }) => {
    const host = new URL(base).host;
    const actorUrl = await resolveWebFinger(`acct:alice@${host}`, {
      fetchImpl: (url, opts) => fetch(url.replace(`https://${host}`, base), opts),
    });
    assert.equal(actorUrl, `${base}/actors/alice`);
  });
});

test('resolveWebFinger rejects a malformed handle', async () => {
  await assert.rejects(() => resolveWebFinger('not-a-handle'));
});

test('resolveWebFinger surfaces a non-2xx response as an error', async () => {
  await withRemoteInstance(async ({ base }) => {
    const host = new URL(base).host;
    await assert.rejects(() =>
      resolveWebFinger(`bob@${host}`, {
        fetchImpl: (url, opts) => fetch(url.replace(`https://${host}`, base), opts),
      }),
    );
  });
});

test('fetchActor fetches and validates an actor document', async () => {
  await withRemoteInstance(async ({ base }) => {
    const actor = await fetchActor(`${base}/actors/alice`);
    assert.equal(actor.id, `${base}/actors/alice`);
    assert.equal(actor.preferredUsername, 'alice');
  });
});

test('fetchActor rejects a document missing inbox/id', async () => {
  await withRemoteInstance(async ({ base }) => {
    await assert.rejects(() => fetchActor(`${base}/actors/missing-inbox`));
  });
});

test('fetchActor surfaces a non-2xx response as an error', async () => {
  await withRemoteInstance(async ({ base }) => {
    await assert.rejects(() => fetchActor(`${base}/actors/nobody`));
  });
});

test('resolveActorPublicKey returns a usable KeyObject matching the keyId', async () => {
  await withRemoteInstance(async ({ base, rsa }) => {
    const keyId = `${base}/actors/alice#transport-key`;
    const { publicKey, actor } = await resolveActorPublicKey(keyId);
    assert.equal(actor.id, `${base}/actors/alice`);
    assert.equal(publicKey.asymmetricKeyType, 'rsa');
    assert.equal(publicKey.export({ format: 'pem', type: 'spki' }), rsa.publicKeyPem);
  });
});

test('resolveActorPublicKey rejects a keyId that does not match the actor publicKey.id', async () => {
  await withRemoteInstance(async ({ base }) => {
    await assert.rejects(() => resolveActorPublicKey(`${base}/actors/alice#wrong-fragment`));
  });
});
