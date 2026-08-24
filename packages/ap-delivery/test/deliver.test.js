import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateRsaTransportKeypair } from '@qu/ap-core';
import { deliverActivity } from '../src/deliver.js';

test('delivers to every inbox independently and reports per-inbox status', async () => {
  const calls = [];
  const fetchImpl = async (inbox, options) => {
    calls.push(inbox);
    if (inbox === 'https://fails.example/inbox') {
      return { ok: false, status: 502 };
    }
    return { ok: true, status: 202 };
  };
  const { privateKey } = generateRsaTransportKeypair();

  const results = await deliverActivity(
    { id: 'https://sender.example/activities/1', type: 'Create' },
    {
      inboxes: ['https://a.example/inbox', 'https://fails.example/inbox'],
      keyId: 'https://sender.example/actors/alice#transport-key',
      privateKey,
      fetchImpl,
    },
  );

  assert.deepEqual(calls.sort(), ['https://a.example/inbox', 'https://fails.example/inbox']);
  assert.deepEqual(
    results.map((r) => [r.inbox, r.ok, r.status]).sort(),
    [
      ['https://a.example/inbox', true, 202],
      ['https://fails.example/inbox', false, 502],
    ],
  );
});

test('a thrown network error is captured per-inbox rather than propagating', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const { privateKey } = generateRsaTransportKeypair();

  const results = await deliverActivity(
    { id: 'https://sender.example/activities/1' },
    { inboxes: ['https://down.example/inbox'], keyId: 'x', privateKey, fetchImpl },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, 'ECONNREFUSED');
});

test('end-to-end: a real signed delivery to a local HTTP inbox', async () => {
  let received;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      res.writeHead(202);
      res.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const { privateKey } = generateRsaTransportKeypair();
    const activity = { id: 'https://sender.example/activities/1', type: 'Create' };
    const results = await deliverActivity(activity, {
      inboxes: [`http://127.0.0.1:${port}/inbox`],
      keyId: 'https://sender.example/actors/alice#transport-key',
      privateKey,
    });

    assert.equal(results[0].ok, true);
    assert.equal(results[0].status, 202);
    assert.ok(received.headers.signature.includes('keyId='));
    assert.equal(JSON.parse(received.body).id, activity.id);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
