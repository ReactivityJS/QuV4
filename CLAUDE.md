# CLAUDE.md

This repo is the ActivityPub-native rewrite of Qu. **Read
`docs/rewrite-plan.md` in full before making architectural decisions** — it
is the binding source of truth for what gets built, in what order, and why.
This file only summarizes the parts that matter for day-to-day edits.

## Non-negotiables from the plan

- One data model, one reactivity system, one wire format — for federated
  and local data alike. There is no separate Qu-Core store; do not
  reintroduce one.
- Access control is exclusively AP Audience/Group. Never add a parallel
  Qu-specific ACL.
- Private data (Class B — personal, cross-device; and any private-visibility
  Class C data) must be structurally impossible to leave a device or land
  on a relay unencrypted. Guard this at the publish API boundary, not by
  convention.
- Three data-locality classes: A (device-local, never synced), B (private,
  cross-device via a personal "my devices" Group, always encrypted), C
  (federated/social). See the table in `docs/rewrite-plan.md`.
- Three event durability tiers: `ephemeral`, `session`, `persistent`. This
  is a generic, reusable concept — don't special-case it per app.
- `packages/ap-client`'s `publish()`/`watch()` is the *only* API app authors
  use, regardless of data class.
- Offline/mobile-first is a required property, not an optional extra: the
  client-side `ap-store` is always a full local copy (never a cache that
  goes empty offline), writes go through a local outbox queue, and
  reconnect always pulls the inbox via `qu:Resume{since}` before/while the
  realtime channel comes back up.
- "QuRelay" names one server deployment/process playing two roles at once:
  the standard AP-server role (`ap-router.js`) and the Qu-native
  "QuServer" role (`http-router.js` — PWA/app hosting, push routing).
  Never split these into separate processes or introduce a third storage
  format between them; both roles share the same `RuntimeContainer`.
- The platform/app layer built on QuRelay + QuClient is called
  **Quniverse**. See `docs/rewrite-plan.md`'s "Ergänzung" and
  "Produktvision" sections for the full addendum (offline-first detail,
  QuRelay/QuServer hook points, and the CMS/website-builder-in-the-
  Fediverse concept).

## Conventions

- npm workspaces (`packages/*`, `apps/*`), plain ES modules (`type:
  module`), no TypeScript/bundler for source. Node ≥20. `node --test` is
  the only test runner — tests live in each package's `test/` directory.
- Keep runtime dependencies minimal and prefer building small primitives
  (canonicalization, base58/multibase, signatures) over pulling in
  packages, consistent with QuV3's dependency policy (see the plan's
  appendix).
- Package naming: `@qu/<name>` (e.g. `@qu/as2`, `@qu/ap-core`).
- When a plan section says a file is "kept unchanged from QuV3", QuV4 has
  no such file yet — it must still be authored fresh; only the *design* is
  inherited, not the code.

## Where things stand

See the status log in `README.md` for which phase/package is done vs.
pending.
