// Smoke test for the actual runnable entrypoint (src/serve.js) — spawns it
// as a real child process, the same way Docker's CMD does, and hits it
// over real HTTP. Everything else in this package's test suite exercises
// the library code directly; this is the one test proving the wiring in
// serve.js itself (env-var config, /healthz, ap-router + realtime bridge
// both actually coming up) works end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVE_SCRIPT = join(__dirname, '..', 'src', 'serve.js');

async function waitForHealthz(port, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error(`serve.js did not become healthy on :${port} within ${timeoutMs}ms`);
}

test('serve.js boots, serves webfinger/actor, and responds to /healthz', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'qu-relay-serve-'));
  const port = randomInt(40000, 60000);
  const host = `localhost:${port}`;

  const child = spawn(process.execPath, [SERVE_SCRIPT], {
    env: { ...process.env, QU_HOST: host, QU_PORT: String(port), QU_USERNAME: 'admin', QU_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealthz(port);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');

    const jrd = await (
      await fetch(`http://127.0.0.1:${port}/.well-known/webfinger?resource=${encodeURIComponent(`acct:admin@${host}`)}`)
    ).json();
    assert.equal(jrd.subject, `acct:admin@${host}`);

    const actor = await (await fetch(`http://127.0.0.1:${port}/actors/admin`)).json();
    assert.equal(actor.id, `https://${host}/actors/admin`);
    assert.ok(actor.publicKey.publicKeyPem.includes('BEGIN PUBLIC KEY'));

    const outbox = await (await fetch(`http://127.0.0.1:${port}/actors/admin/outbox`)).json();
    assert.equal(outbox.type, 'OrderedCollectionPage');

    assert.equal(stderr, '');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
