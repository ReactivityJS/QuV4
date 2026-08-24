// X25519 Multikey encoding — same did:key-style multibase/multicodec
// scheme as @qu/ap-core's Ed25519 identity keys, different multicodec
// value (x25519-pub = 0xec, varint-encoded as [0xec, 0x01] since 0xec is
// >= 128), so an encryption key can never be mistaken for an identity key
// even though both are 32-byte curve25519-family public keys.

import { base58Encode, base58Decode } from '@qu/ap-core';

const MULTICODEC_X25519_PUB = Buffer.from([0xec, 0x01]);
const MULTIBASE_BASE58BTC_PREFIX = 'z';

export function encodeX25519Multikey(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) {
    throw new Error('encodeX25519Multikey: expected 32 raw bytes');
  }
  return MULTIBASE_BASE58BTC_PREFIX + base58Encode(Buffer.concat([MULTICODEC_X25519_PUB, raw32]));
}

export function decodeX25519Multikey(multikey) {
  if (typeof multikey !== 'string' || !multikey.startsWith(MULTIBASE_BASE58BTC_PREFIX)) {
    throw new Error('decodeX25519Multikey: not a base58btc multibase string');
  }
  const decoded = base58Decode(multikey.slice(1));
  if (decoded.length !== 34 || !decoded.subarray(0, 2).equals(MULTICODEC_X25519_PUB)) {
    throw new Error('decodeX25519Multikey: not an x25519-pub multicodec value');
  }
  return decoded.subarray(2);
}
