import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { SseServerTransport } from '../src/sse-server-transport.js';
import { SseClientTransport } from '../src/sse-client-transport.js';
import { buildDataFrame } from '../src/frame.js';
import { DURABILITY } from '@qu/as2';

async function withServer(run) {
  const transport = new SseServerTransport();
  const httpServer = createServer((req, res) => transport.handleRequest(req, res));
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const { port } = httpServer.address();
  try {
    await run({ transport, url: `http://127.0.0.1:${port}/realtime` });
  } finally {
    transport.close();
    httpServer.close();
    await once(httpServer, 'close');
  }
}

const sampleFrame = () =>
  buildDataFrame({ id: 'https://relay.example/1', doc: { id: 'https://relay.example/1' }, durability: DURABILITY.PERSISTENT });

test('a client connecting triggers onConnection on the server', async () => {
  await withServer(async ({ transport, url }) => {
    const seen = [];
    transport.onConnection((peerId) => seen.push(peerId));

    const client = new SseClientTransport({ url });
    await client.connect();
    await sleep(20);

    assert.equal(seen.length, 1);
    assert.equal(transport.peerCount(), 1);
    client.close();
  });
});

test('server -> client: sendTo(peerId, frame) is received by the client', async () => {
  await withServer(async ({ transport, url }) => {
    let peerId;
    transport.onConnection((id) => {
      peerId = id;
    });

    const client = new SseClientTransport({ url });
    const received = [];
    client.onMessage((frame) => received.push(frame));
    await client.connect();
    await sleep(20);

    const frame = sampleFrame();
    transport.sendTo(peerId, frame);
    await sleep(20);

    assert.deepEqual(received, [frame]);
    client.close();
  });
});

test('broadcast reaches every connected peer except the excluded one', async () => {
  await withServer(async ({ transport, url }) => {
    const peerIds = [];
    transport.onConnection((id) => peerIds.push(id));

    const a = new SseClientTransport({ url });
    const b = new SseClientTransport({ url });
    const receivedA = [];
    const receivedB = [];
    a.onMessage((f) => receivedA.push(f));
    b.onMessage((f) => receivedB.push(f));
    await a.connect();
    await b.connect();
    await sleep(20);

    const frame = sampleFrame();
    transport.broadcast(frame, { except: peerIds[0] });
    await sleep(20);

    assert.deepEqual(receivedA, []);
    assert.deepEqual(receivedB, [frame]);
    a.close();
    b.close();
  });
});

test('multiple frames arrive in order', async () => {
  await withServer(async ({ transport, url }) => {
    let peerId;
    transport.onConnection((id) => {
      peerId = id;
    });
    const client = new SseClientTransport({ url });
    const received = [];
    client.onMessage((f) => received.push(f.id));
    await client.connect();
    await sleep(20);

    for (let i = 0; i < 5; i += 1) {
      transport.sendTo(
        peerId,
        buildDataFrame({ id: `https://relay.example/${i}`, doc: { id: `https://relay.example/${i}` }, durability: DURABILITY.PERSISTENT }),
      );
    }
    await sleep(30);

    assert.deepEqual(received, Array.from({ length: 5 }, (_, i) => `https://relay.example/${i}`));
    client.close();
  });
});

test('client.send throws: SSE is receive-only', () => {
  const client = new SseClientTransport({ url: 'http://127.0.0.1:1/x' });
  assert.throws(() => client.send({}), /receive-only/);
});

test('client.close() triggers the server-side peer close (peerCount drops)', async () => {
  await withServer(async ({ transport, url }) => {
    const client = new SseClientTransport({ url });
    await client.connect();
    await sleep(20);
    assert.equal(transport.peerCount(), 1);

    client.close();
    await sleep(50);
    assert.equal(transport.peerCount(), 0);
  });
});

test('requires url to construct the client', () => {
  assert.throws(() => new SseClientTransport({}));
});

test('connect() rejects for a non-2xx response', async () => {
  const httpServer = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const { port } = httpServer.address();
  try {
    const client = new SseClientTransport({ url: `http://127.0.0.1:${port}/nope` });
    await assert.rejects(() => client.connect());
  } finally {
    httpServer.close();
    await once(httpServer, 'close');
  }
});
