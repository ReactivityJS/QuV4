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

- **Phase 0 (foundation) — done.** 85/85 tests passing (`npm test`).
  - `packages/as2` — AS2/JSON-LD vocabulary, ID minting, audience
    normalization, JCS (RFC 8785) canonicalization.
  - `packages/ap-core` — Multikey (Ed25519 + throwaway RSA-2048 transport
    key), Actor document building, WebFinger, NodeInfo, HTTP Signatures
    (draft-cavage, rsa-sha256), signed fetch, Collection serialization.
  - `packages/local-vault` — KV store for the raw identity seed and the
    RSA transport keypair (Memory + Fs adapters), physically separated
    from any sync/delivery code path.

Everything else (`packages/ap-store`, `ap-ingest`, `ap-delivery`,
`ap-realtime`, `ap-groups`, `ap-encryption`, `ap-signal`, `ap-client`,
`ap-cms`, `reactive`, `relay`, apps, ...) is future phase work — see the
phase table and the "Quniverse" addendum in `docs/rewrite-plan.md`.
