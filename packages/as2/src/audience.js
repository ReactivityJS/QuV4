// AS2 audience normalization: `to`/`cc`/`bto`/`bcc`/`audience` may each be a
// single URI string, an array of URI strings, or absent. This module turns
// that into one canonical shape so every other package (ap-ingest,
// ap-delivery, ap-client) can rely on arrays and a single recipient set,
// instead of re-implementing the AS2 addressing quirks.

import { PUBLIC_AUDIENCE } from './vocabulary.js';

const ADDRESSING_FIELDS = ['to', 'cc', 'bto', 'bcc', 'audience'];

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function idOf(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
    return entry.id;
  }
  return null;
}

/**
 * Normalize the addressing fields of an AS2 object/activity into a
 * canonical shape:
 *   { public, to, cc, bto, bcc, audience, recipients }
 * `recipients` is the de-duplicated union of all fields (including the
 * blind ones), minus the public marker — i.e. everyone who should actually
 * receive a delivery.
 */
export function normalizeAudience(entity = {}) {
  const normalized = {};
  const recipients = new Set();
  let isPublic = false;

  for (const field of ADDRESSING_FIELDS) {
    const ids = toArray(entity[field])
      .map(idOf)
      .filter((id) => typeof id === 'string' && id.length > 0);
    const deduped = [...new Set(ids)];
    normalized[field] = deduped;
    for (const id of deduped) {
      if (id === PUBLIC_AUDIENCE) {
        isPublic = true;
      } else {
        recipients.add(id);
      }
    }
  }

  normalized.public = isPublic;
  normalized.recipients = [...recipients];
  return normalized;
}

/** True if the entity's addressing includes the public AS2 collection. */
export function isPublicAudience(entity) {
  return normalizeAudience(entity).public;
}

/**
 * Per AS2 §5.6, `bto`/`bcc` must never be included in the copy of an
 * object/activity that gets delivered or stored publicly — they exist only
 * to compute the recipient set at send time. Returns a shallow copy with
 * both fields removed.
 */
export function stripBlindAddressing(entity = {}) {
  const { bto, bcc, ...rest } = entity;
  return rest;
}
