#!/usr/bin/env node
// QuRelay bootstrap: the actual runnable process. FsAdapter-backed
// ap-store, FsVaultAdapter-backed identity vault, one HTTP server serving
// both the AP-server role (ap-router.js) and the realtime bridge — exactly
// as docs/rewrite-plan.md's "QuRelay = one process, two roles" rule
// requires. There is deliberately no separate "start the realtime server"
// step.
//
// Known simplifications carried forward from README.md's "Known gaps":
// single actor per vault (no HD multi-actor identity yet), the realtime
// `hello` handshake trusts the claimed actorId (no session/auth layer
// yet), and there's no QuServer role (PWA hosting, push routing) yet —
// this process only ever plays QuRelay's AP-server + realtime half.
//
// Configuration is via environment variables (see README.md / docker-
// compose.yml): QU_HOST (public hostname used to build actor/AS2 ids —
// must be the hostname a client-facing HTTPS endpoint terminates as, even
// though this process itself only ever speaks plain HTTP), QU_PORT,
// QU_USERNAME, QU_DATA_DIR.

import { createServer } from 'node:http';
import { join } from 'node:path';
import { QuEvents } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { FsAdapter } from '@qu/runtime';
import { LocalVault, FsVaultAdapter } from '@qu/local-vault';
import { resolveActorPublicKey } from '@qu/ap-core';
import { ensureLocalActor } from './local-actor.js';
import { ActorRegistry } from './registry.js';
import { createApRouter } from './ap-router.js';
import { createRealtimeBridge } from './realtime-bridge.js';

const HOST = process.env.QU_HOST ?? 'localhost';
const PORT = Number(process.env.QU_PORT ?? 3000);
const USERNAME = process.env.QU_USERNAME ?? 'admin';
const DATA_DIR = process.env.QU_DATA_DIR ?? './data';

async function main() {
  const events = new QuEvents();
  const store = new ApStore({ adapter: new FsAdapter(join(DATA_DIR, 'store')), events });
  const vault = new LocalVault(new FsVaultAdapter(join(DATA_DIR, 'vault')));

  const actorRecord = await ensureLocalActor({ vault, host: HOST, username: USERNAME });
  const registry = new ActorRegistry();
  registry.register(actorRecord);

  const server = createServer();

  const handleApRoutes = createApRouter({
    host: HOST,
    registry,
    store,
    events,
    resolveActorKey: resolveActorPublicKey,
    software: { name: 'quniverse', version: '0.0.0' },
  });

  server.on('request', async (req, res) => {
    // /healthz is an ops concern, not an AP route — handled here rather
    // than in ap-router.js, which stays scoped to federation routes only.
    const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    await handleApRoutes(req, res);
  });

  createRealtimeBridge({ server, store, events, registry });

  server.listen(PORT, () => {
    console.log(`QuRelay listening on :${PORT}`);
    console.log(`  actor:      ${actorRecord.actor.id}`);
    console.log(`  webfinger:  acct:${USERNAME}@${HOST}`);
    console.log(`  data dir:   ${DATA_DIR}`);
  });
}

main().catch((err) => {
  console.error('QuRelay failed to start:', err);
  process.exitCode = 1;
});
