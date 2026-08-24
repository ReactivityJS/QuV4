// AS2 object/activity ID minting. AS2 ids are dereferenceable URLs, so
// minting means: pick a collision-resistant local id, then hang it off an
// actor's base URL under a collection segment (e.g. `.../outbox/<localId>`).
//
// The local id itself is a ULID-shaped, lexicographically sortable
// identifier (48-bit timestamp + 80 bits of randomness, Crockford base32),
// built from scratch to avoid pulling in a dependency for something this
// small — consistent with the repo-wide minimal-dependency policy.

import { randomBytes } from 'node:crypto';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(bytes) {
  let bits = 0n;
  let bitCount = 0;
  let out = '';
  for (const byte of bytes) {
    bits = (bits << 8n) | BigInt(byte);
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const index = Number((bits >> BigInt(bitCount)) & 0x1fn);
      out += CROCKFORD_ALPHABET[index];
    }
  }
  if (bitCount > 0) {
    const index = Number((bits << BigInt(5 - bitCount)) & 0x1fn);
    out += CROCKFORD_ALPHABET[index];
  }
  return out;
}

/**
 * Mint a ULID-shaped local identifier: sortable by creation time, globally
 * unique with overwhelming probability.
 */
export function mintLocalId(now = Date.now()) {
  const timeBytes = Buffer.alloc(6);
  timeBytes.writeUIntBE(now % 2 ** 48, 0, 6);
  const randomPart = randomBytes(10);
  return encodeBase32(Buffer.concat([timeBytes, randomPart]));
}

/**
 * Mint a full AS2 id URL for an object/activity owned by `actorId`, e.g.
 * mintId({ actorBase: 'https://relay.example/actors/abc', collection: 'outbox' })
 * -> 'https://relay.example/actors/abc/outbox/01H...'
 */
export function mintId({ actorBase, collection, localId = mintLocalId() }) {
  if (!actorBase) throw new Error('mintId: actorBase is required');
  if (!collection) throw new Error('mintId: collection is required');
  const base = actorBase.endsWith('/') ? actorBase.slice(0, -1) : actorBase;
  return `${base}/${collection}/${localId}`;
}
