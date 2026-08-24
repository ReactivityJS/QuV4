// Ed25519 identity keys, encoded as `did:key`-style Multikey strings
// (multicodec 0xed01 + base58btc, prefixed 'z') for use in AS2 Actor
// `assertionMethod` entries and `qu:proof`. Also generates the throwaway
// RSA-2048 transport keypair used only for the outer HTTP Signature
// envelope (Mastodon-compatible federation), which carries no identity
// meaning of its own — see docs/rewrite-plan.md decision 5.

import {
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { base58Encode, base58Decode } from './base58.js';

// multicodec varint for ed25519-pub (0xed, 0x01), per the multicodec table.
const MULTICODEC_ED25519_PUB = Buffer.from([0xed, 0x01]);
const MULTIBASE_BASE58BTC_PREFIX = 'z';

// RFC 8410 fixed DER wrappers for raw 32-byte Ed25519 keys. Node's WebCrypto
// bindings only accept SPKI/PKCS8 DER (or JWK) for Ed25519, not raw bytes
// directly, so raw<->KeyObject conversion goes through these constant
// prefixes rather than a general ASN.1 encoder.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function rawFromKeyObject(keyObject) {
  const jwk = keyObject.export({ format: 'jwk' });
  const field = keyObject.type === 'private' ? jwk.d : jwk.x;
  return Buffer.from(field, 'base64url');
}

/** Build a public-key KeyObject from 32 raw Ed25519 public-key bytes. */
export function ed25519PublicKeyFromRaw(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) {
    throw new Error('ed25519PublicKeyFromRaw: expected 32 raw bytes');
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw32]),
    format: 'der',
    type: 'spki',
  });
}

/** Build a private-key KeyObject from a 32-byte Ed25519 seed. */
export function ed25519PrivateKeyFromSeed(seed32) {
  if (!Buffer.isBuffer(seed32) || seed32.length !== 32) {
    throw new Error('ed25519PrivateKeyFromSeed: expected a 32-byte seed');
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed32]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Encode 32 raw Ed25519 public-key bytes as a multibase/multicodec Multikey string. */
export function encodeEd25519Multikey(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) {
    throw new Error('encodeEd25519Multikey: expected 32 raw bytes');
  }
  return MULTIBASE_BASE58BTC_PREFIX + base58Encode(Buffer.concat([MULTICODEC_ED25519_PUB, raw32]));
}

/** Decode a Multikey string back to 32 raw Ed25519 public-key bytes. */
export function decodeEd25519Multikey(multikey) {
  if (typeof multikey !== 'string' || !multikey.startsWith(MULTIBASE_BASE58BTC_PREFIX)) {
    throw new Error('decodeEd25519Multikey: not a base58btc multibase string');
  }
  const decoded = base58Decode(multikey.slice(1));
  if (decoded.length !== 34 || !decoded.subarray(0, 2).equals(MULTICODEC_ED25519_PUB)) {
    throw new Error('decodeEd25519Multikey: not an ed25519-pub multicodec value');
  }
  return decoded.subarray(2);
}

/**
 * Generate a fresh Ed25519 identity keypair.
 * Returns KeyObjects plus raw bytes and the Multikey string for convenience.
 */
export function generateEd25519Keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return toKeypairResult(publicKey, privateKey);
}

/** Deterministically derive an Ed25519 keypair from a 32-byte seed (e.g. HD-derived). */
export function ed25519KeypairFromSeed(seed32) {
  const privateKey = ed25519PrivateKeyFromSeed(seed32);
  const publicKey = createPublicKey(privateKey);
  return toKeypairResult(publicKey, privateKey);
}

function toKeypairResult(publicKey, privateKey) {
  const publicKeyRaw = rawFromKeyObject(publicKey);
  const privateKeyRaw = rawFromKeyObject(privateKey);
  return {
    publicKey,
    privateKey,
    publicKeyRaw,
    privateKeyRaw,
    publicKeyMultibase: encodeEd25519Multikey(publicKeyRaw),
  };
}

/** Sign `data` (Buffer/string) with an Ed25519 private KeyObject. */
export function ed25519Sign(privateKey, data) {
  const message = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return cryptoSign(null, message, privateKey);
}

/** Verify an Ed25519 signature. `publicKey` may be a KeyObject or a Multikey string. */
export function ed25519Verify(publicKey, data, signature) {
  const keyObject =
    typeof publicKey === 'string'
      ? ed25519PublicKeyFromRaw(decodeEd25519Multikey(publicKey))
      : publicKey;
  const message = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return cryptoVerify(null, message, keyObject, signature);
}

/**
 * Generate the throwaway RSA-2048 transport keypair used only to satisfy
 * Mastodon-style HTTP Signatures on federated delivery. Carries no
 * identity meaning — see docs/rewrite-plan.md decision 5.
 */
export function generateRsaTransportKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
  };
}
