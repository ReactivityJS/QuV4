import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { signedFetch } from '../src/signed-fetch.js';
import { verifyRequest } from '../src/http-signature.js';
import { generateRsaTransportKeypair } from '../src/multikey.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('signedFetch produces a request the server can verify', async () => {
  const { publicKey, privateKey } = generateRsaTransportKeypair();
  const keyId = 'https://relay.example/actors/alice#transport-key';
  let seen;

  await withServer(
    (req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const headers = { ...req.headers, host: req.headers.host };
        seen = verifyRequest({ method: req.method, url: `http://${req.headers.host}${req.url}`, headers, body, publicKey });
        res.writeHead(200);
        res.end('ok');
      });
    },
    async (base) => {
      const res = await signedFetch(`${base}/inbox`, {
        method: 'POST',
        body: JSON.stringify({ type: 'Create' }),
        keyId,
        privateKey,
      });
      assert.equal(res.status, 200);
    },
  );

  assert.equal(seen, true);
});
