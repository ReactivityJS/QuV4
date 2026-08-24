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
- **Known gaps carried forward:** browser storage adapters (IndexedDB/
  localStorage/sessionStorage — Phase 1), HD multi-actor identity
  (`packages/identity` — not yet a package), and `http-router.js` (the
  QuServer role: PWA hosting, push routing — Phase 4/5 territory).

Everything else (`packages/ap-realtime`, `ap-groups`, `ap-encryption`,
`ap-signal`, `ap-client`, `ap-cms`, `identity`, `ui`, apps, ...) is future
phase work — see the phase table and the "Quniverse" addendum in
`docs/rewrite-plan.md`.
