# Quniverse (QuV4) — ActivityPub-native rewrite

Quniverse is a full, privacy-first rewrite of Qu (previously
`ReactivityJS/QuV3`) on top of ActivityPub as the single, native
data/network model — for federated **and** local data alike, offline- and
mobile-first. QuV3's proprietary stack (`QuBit`, `QuStore`, `SyncEngine`,
`AccessEngine`) is not migrated; it is replaced outright.

**QuRelay** is the one server deployment that plays both the standard
AP-server role and the Qu-native "QuServer" role (PWA/app hosting, push
routing) — see `docs/rewrite-plan.md` for the split. **Quniverse** is the
platform/app layer built on top of QuRelay + QuClient: feeds with offline
caching, Forum (Lemmy-compatible), Gallery (Pixelfed-compatible),
Calendar, and Qu-native extras with no AP standard equivalent — WebRTC
signaling, Phone, Chat, games like GeoChase — plus a CMS/website builder
whose templates, styles, and content all live as federated AS2 objects.

The binding architecture decisions, the phased build-out, and the full
rationale live in [`docs/rewrite-plan.md`](docs/rewrite-plan.md). Read that
first — this README only tracks status.

## Monorepo layout

npm workspaces (`packages/*`, `apps/*`), plain ES modules, no
TypeScript/bundler for source itself, Node ≥20, `node --test` as the sole
test runner. Dependencies are kept deliberately minimal — see each
package's `package.json`.

```
npm install
npm test
```

## Running QuRelay

`packages/relay/src/serve.js` is the actual runnable process: one HTTP
server playing both QuRelay roles at once (AP-server routes + the
realtime bridge), backed by `FsAdapter`/`FsVaultAdapter` for durable
storage. Configuration is via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `QU_HOST` | `localhost` | Public hostname baked into actor/AS2 ids — must be the hostname a TLS-terminating reverse proxy in front of this process answers as, even though the process itself only ever speaks plain HTTP. |
| `QU_PORT` | `3000` | Listen port. |
| `QU_USERNAME` | `admin` | The one local actor this process bootstraps (single-actor-per-vault — see "Known gaps"). |
| `QU_DATA_DIR` | `./data` | Where the identity vault and the AS2 object store persist to. |

```
npm start                                    # runs packages/relay/src/serve.js locally
curl http://localhost:3000/healthz           # -> ok
```

### Docker / Docker Compose

```
docker compose run --rm test    # run the full suite inside a container
docker compose up -d relay      # build + run the deployable image
docker compose logs -f relay
```

`relay`'s data directory is a named volume (`relay-data`), so identity and
storage persist across container restarts. Override `QU_HOST`/
`QU_USERNAME`/the published port via a `.env` file or shell environment
before `docker compose up` — see `docker-compose.yml`. The `Dockerfile` has
no build/compile stage (plain ESM, no bundler) — it's just `npm ci` plus a
non-root user, a declared `/data` volume, and a `/healthz`-based
`HEALTHCHECK`.

## Status log

- **Phase 0 (foundation) — done.**
  - `packages/as2` — AS2/JSON-LD vocabulary, ID minting, audience
    normalization, JCS (RFC 8785) canonicalization.
  - `packages/ap-core` — Multikey (Ed25519 + throwaway RSA-2048 transport
    key), Actor document building, WebFinger, NodeInfo, HTTP Signatures
    (draft-cavage, rsa-sha256), signed fetch, Collection serialization.
  - `packages/local-vault` — KV store for the raw identity seed and the
    RSA transport keypair (Memory + Fs adapters), physically separated
    from any sync/delivery code path.
- **Phase 1 (ap-store + reactive) — done.** 160/160 tests passing (`npm test`).
  - `packages/core` — `QuEvents` (the sole internal event bus), plus the
    generic ordered-KV adapter interface: `MemoryStoreAdapter` and the
    TTL-based `VolatileAdapter` (backs ephemeral dedup and session-scoped
    storage).
  - `packages/runtime` — `FsAdapter`, the Node filesystem-backed adapter
    for durable storage on QuRelay/CLI contexts. Browser IndexedDB/
    localStorage/sessionStorage adapters are deferred to when `apps/shell`
    work begins.
  - `packages/ap-store` — the single storage API for data classes B and C:
    `put()`/`get()`/`delete()`/`getChildren()`/`onChange()`, durability-aware
    (`persistent` → adapter, `session` → scoped `VolatileAdapter` cleared by
    `endSession()`, `ephemeral` → dedup-only, never persisted).
  - `packages/reactive` — `watch()`/`watchChildren()`, always re-reading
    through the full `ap-store` pipeline on change (never trusting the raw
    event payload), with stale-read protection for out-of-order resolves.
    This is the stable API `packages/ui`'s QuComponents will sit on once
    that package exists.

- **Phase 2 (server side) — done.** 222/222 tests passing (`npm test`).
  - `packages/ap-core` — added `resolveWebFinger()`/`fetchActor()`/
    `resolveActorPublicKey()` (the network-side resolution ap-ingest and
    ap-delivery need) and `extractKeyId()`.
  - `packages/ap-ingest` — the verify → authorize → side-effect → persist →
    notify pipeline (`ingestActivity()`), applying equally to Class B and
    Class C. HTTP-Signature-verified against the sender's fetched key,
    same-origin authorization (an activity's `actor` must match who
    signed it), persisted via `ap-store`. Every step is bracketed by a
    QuEvents hook (`beforeVerify`/`afterVerify`/`beforeAuthorize`/
    `afterAuthorize`/`beforeSideEffect`/`afterPersist`/`beforeNotify`) on
    the *same* shared bus `ap-store` itself emits `change` on — one event
    bus, not one per package.
  - `packages/ap-delivery` — `resolveInboxes()` (sharedInbox-deduped),
    `deliverActivity()` (signed POST), and `DeliveryQueue`: the
    persistent-tier retry queue backed by `ap-store`, with exponential
    backoff and a proven-durable restart (a queued entry survives a fresh
    `ApStore`/`FsAdapter` pair pointed at the same directory). This is the
    server-side half of the offline-first outbox.
  - `packages/relay` — `ap-router.js`: the AP-server routes (WebFinger,
    NodeInfo, Actor, Inbox, sharedInbox, Outbox/Followers/Following) on
    plain `node:http`, no framework — extensibility comes entirely from
    the shared QuEvents hooks, not a second plugin mechanism. Plus
    `ensureLocalActor()` (single-actor-per-vault bootstrap; full HD
    multi-actor identity is still future `packages/identity` work) and
    `wireAutoAcceptFollows()`, a worked example of hook-based policy
    (auto-Accept is opt-in, not built into `ap-ingest`).
  - **Milestone M1 verification, honestly scoped:** this environment has
    no network access to a live Mastodon instance, so M1 couldn't be
    checked against one directly. What *is* verified, end-to-end, with
    nothing mocked: two fully independent, fully-wired relay processes
    (own store, own actor, own HTTP server) federate over real HTTP —
    WebFinger discovery, RSA HTTP-Signature-signed delivery, verified
    ingest, and an auto-generated `Accept` delivered back — see
    `packages/relay/test/federation-e2e.test.js`. That proves the wire
    protocol itself is correct; compatibility with a specific real
    instance's quirks still needs checking after deployment.
- **Phase 3 (realtime + ap-client) — done.** 299/299 tests passing (`npm test`).
  - `packages/ap-store` — added `getChildrenSince()` (ascending, cursor-
    bounded) for `qu:Resume{since}` replay, and `change` events now carry
    `ts` so a *live* broadcast can also advance a client's cursor, not
    just an explicit resume.
  - `packages/ap-realtime` — the one wire envelope, `qu:StreamFrame`
    (`kind: object|activity|ephemeral|session|control`), covering both
    data and control frames (`hello`/`subscribe`/`unsubscribe`/`resume`/
    `resumed`). `WebSocketClientTransport`/`WebSocketServerTransport` (via
    `ws` — QuV3's own precedent exception to the minimal-deps policy) as
    the standard transport; `SseClientTransport`/`SseServerTransport` (via
    `fetch`'s streaming body, not `EventSource`) for restrictive networks,
    receive-only by nature. `replayResume()` is the shared server-side
    replay logic both the relay and any future transport reuse.
  - `packages/relay` — `realtime-bridge.js`: wires `WebSocketServerTransport`
    onto the *same* HTTP server `ap-router.js` runs on (one QuRelay
    process, one port). Per-peer `hello`/`subscribe`/`resume` handshake,
    live broadcast bridged straight off `ap-store`'s shared `QuEvents`
    bus, and authorization that a peer may only publish under its own
    actor's collections. **Known simplification:** the `hello` handshake
    trusts the claimed `actorId` outright — there is no session/auth layer
    yet; a real deployment must verify this before shipping.
  - `packages/ap-client` — `publish()`/`watch()`/`watchChildren()`, the one
    API app authors use for any data class. Writes land in the local
    `ap-store` immediately (optimistic, offline-safe); `persistent` writes
    also queue in a durable local outbox (collapsing repeated offline
    edits to the same id into one entry) until actually handed to the
    transport; `ephemeral`/`session` writes are best-effort, live-only,
    never queued. Every connect (or reconnect) always goes hello →
    subscribe → resume → flush-outbox → live, with the resume cursor
    itself persisted locally so it survives an app restart, not just a
    reconnect. **Known simplification:** detecting a drop and reconnecting
    is the caller's job — this class reacts correctly to reconnection but
    doesn't loop/backoff on its own yet.
  - **Milestone M2, verified end-to-end, nothing mocked:**
    `packages/relay/test/m2-two-tab-e2e.test.js` runs two `ApClient`s
    (separate local stores, real WebSocket) against one relay, both
    representing the same actor's own devices ("two tabs"): a live publish
    on one appears on the other; a tab that goes offline, misses two
    publishes, and reconnects catches up via resume with no loss and no
    duplication; ephemeral frames are proven live-only (never persisted,
    never replayed); session frames are proven visible to connected peers
    but never replayed to a later joiner.
- **Known gaps carried forward:** browser storage adapters (IndexedDB/
  localStorage/sessionStorage — Phase 1), HD multi-actor identity
  (`packages/identity` — not yet a package), `http-router.js` (the
  QuServer role: PWA hosting, push routing — Phase 4/5 territory), the
  realtime `hello` handshake's trust-on-claim actor identity (needs real
  session/auth), and client-side auto-reconnect/backoff for `ap-client`.
- **Deployment infra — done.** 300/300 tests passing (`npm test`).
  `packages/relay/src/serve.js` is the first actual runnable entrypoint
  (env-var configured, `FsAdapter`/`FsVaultAdapter`-backed, `/healthz`),
  smoke-tested by spawning it as a real child process
  (`packages/relay/test/serve.test.js`). `Dockerfile` + `docker-compose.yml`
  add a `test` service (full suite in-container) and a `relay` service
  (build + run the deployable image, persistent named volume) — see
  "Running QuRelay" above.

Everything else (`ap-groups`, `ap-encryption`, `ap-signal`, `ap-cms`,
`identity`, `ui`, apps, ...) is future phase work — see the phase table and
the "Quniverse" addendum in `docs/rewrite-plan.md`.
