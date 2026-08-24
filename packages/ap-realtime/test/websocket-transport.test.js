import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { WebSocketServerTransport } from '../src/websocket-server-transport.js';
import { WebSocketClientTransport } from '../src/websocket-client-transport.js';
import { buildDataFrame } from '../src/frame.js';
import { DURABILITY } from '@qu/as2';

async function withServer(run) {
  const httpServer = createServer();
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const { port } = httpServer.address();
  const transport = new WebSocketServerTransport({ server: httpServer, path: '/realtime' });
  try {
    await run({ transport, url: `ws://127.0.0.1:${port}/realtime` });
  } finally {
    transport.close();
    httpServer.close();
    await once(httpServer, 'close');
  }
}

const sampleFrame = () =>
  buildDataFrame({ id: 'https://relay.example/1', doc: { id: 'https://relay.example/1' }, durability: DURABILITY.PERSISTENT });

test('a client can connect and the server sees onConnection fire', async () => {
  await withServer(async ({ transport, url }) => {
    const seen = [];
    transport.onConnection((peerId) => seen.push(peerId));

    const client = new WebSocketClientTransport({ url });
    await client.connect();
    await sleep(20);

    assert.equal(seen.length, 1);
    assert.equal(transport.peerCount(), 1);
    client.close();
  });
});

test('client -> server: a sent frame arrives at the peer connection', async () => {
  await withServer(async ({ transport, url }) => {
    const received = [];
    transport.onConnection((peerId, peer) => {
      peer.onMessage((frame) => received.push(frame));
    });

    const client = new WebSocketClientTransport({ url });
    await client.connect();
    const frame = sampleFrame();
    client.send(frame);
    await sleep(20);

    assert.deepEqual(received, [frame]);
    client.close();
  });
});

test('server -> client: sendTo(peerId, frame) reaches only that peer', async () => {
  await withServer(async ({ transport, url }) => {
    let peerId;
    transport.onConnection((id) => {
      peerId = id;
    });

    const client = new WebSocketClientTransport({ url });
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

    const a = new WebSocketClientTransport({ url });
    const b = new WebSocketClientTransport({ url });
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

test('peerCount drops when a client disconnects', async () => {
  await withServer(async ({ transport, url }) => {
    const client = new WebSocketClientTransport({ url });
    await client.connect();
    await sleep(20);
    assert.equal(transport.peerCount(), 1);

    client.close();
    await sleep(50);
    assert.equal(transport.peerCount(), 0);
  });
});

test('client onClose fires when the server closes the peer connection', async () => {
  await withServer(async ({ transport, url }) => {
    transport.onConnection((_id, peer) => peer.close());

    const client = new WebSocketClientTransport({ url });
    let closed = false;
    client.onClose(() => {
      closed = true;
    });
    await client.connect();
    await sleep(50);

    assert.equal(closed, true);
  });
});

test('a malformed message from the client is silently dropped, not delivered or crashing', async () => {
  await withServer(async ({ transport, url }) => {
    const received = [];
    transport.onConnection((_id, peer) => peer.onMessage((frame) => received.push(frame)));

    const raw = new WebSocket(url);
    await once(raw, 'open');
    raw.send('not a valid frame');
    await sleep(20);

    assert.deepEqual(received, []);
    raw.close();
  });
});

test('client.send throws if not connected', () => {
  const client = new WebSocketClientTransport({ url: 'ws://127.0.0.1:1/x' });
  assert.throws(() => client.send(sampleFrame()));
});

test('requires url/server to construct', () => {
  assert.throws(() => new WebSocketClientTransport({}));
  assert.throws(() => new WebSocketServerTransport({}));
});
