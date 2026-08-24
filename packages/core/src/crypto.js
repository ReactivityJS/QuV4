// QuCrypto — X25519 (ECDH) + AES-256-GCM, the primitives `qu:encryptedPayload`
// (packages/ap-encryption) is built on. Kept here rather than in
// ap-encryption because it's pure cryptographic infrastructure with no AS2/
// wire-format opinions — see docs/rewrite-plan.md's "Kritische Dateien".
//
// Envelope shape: one random AES-256 content key encrypts the plaintext
// once; that content key is then wrapped individually per recipient via
// X25519 ECDH + AES-256-GCM — the same "one bulk key, wrapped per
// recipient" pattern QuV3 used. The per-recipient wrap key is
// SHA-256(ECDH shared secret) — a single-step KDF, not full HKDF. That's a
// deliberate simplification for now: adequate because the shared secret is
// only ever used for this one wrap key, but worth hardening (HKDF with a
// proper info/salt binding) before this handles anything beyond this
// phase's scope.

import {
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  diffieHellman,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from 'node:crypto';

// RFC 8410 fixed DER wrappers for raw 32-byte X25519 keys — same trick as
// ap-core's Ed25519 multikey.js, different OID arc (1.3.101.110 vs .112).
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

const CONTENT_KEY_BYTES = 32; // AES-256
const GCM_IV_BYTES = 12; // standard AES-GCM nonce size

function rawFromKeyObject(keyObject) {
  const jwk = keyObject.export({ format: 'jwk' });
  const field = keyObject.type === 'private' ? jwk.d : jwk.x;
  return Buffer.from(field, 'base64url');
}

/** Build a public-key KeyObject from 32 raw X25519 public-key bytes. */
export function x25519PublicKeyFromRaw(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) {
    throw new Error('x25519PublicKeyFromRaw: expected 32 raw bytes');
  }
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw32]), format: 'der', type: 'spki' });
}

/** Build a private-key KeyObject from a 32-byte X25519 seed. */
export function x25519PrivateKeyFromSeed(seed32) {
  if (!Buffer.isBuffer(seed32) || seed32.length !== 32) {
    throw new Error('x25519PrivateKeyFromSeed: expected a 32-byte seed');
  }
  return createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, seed32]), format: 'der', type: 'pkcs8' });
}

function toKeypairResult(publicKey, privateKey) {
  return {
    publicKey,
    privateKey,
    publicKeyRaw: rawFromKeyObject(publicKey),
    privateKeyRaw: rawFromKeyObject(privateKey),
  };
}

/** Generate a fresh X25519 encryption keypair. */
export function generateX25519Keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return toKeypairResult(publicKey, privateKey);
}

/** Deterministically derive an X25519 keypair from a 32-byte seed. */
export function x25519KeypairFromSeed(seed32) {
  const privateKey = x25519PrivateKeyFromSeed(seed32);
  const publicKey = createPublicKey(privateKey);
  return toKeypairResult(publicKey, privateKey);
}

/** X25519 ECDH: the shared secret two parties independently arrive at. */
export function ecdh(privateKey, publicKey) {
  return diffieHellman({ privateKey, publicKey });
}

export function sha256(data) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return createHash('sha256').update(buf).digest();
}

function aesGcmEncrypt(key, plaintext) {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertext, authTag: cipher.getAuthTag() };
}

function aesGcmDecrypt(key, { iv, ciphertext, authTag }) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt `plaintext` for one or more recipients.
 *
 * @param {string|Buffer} plaintext
 * @param {object} params
 * @param {import('node:crypto').KeyObject} params.senderPrivateKey - sender's X25519 private key
 * @param {{ id: string, publicKey: import('node:crypto').KeyObject }[]} params.recipients
 * @returns {{ iv: Buffer, ciphertext: Buffer, authTag: Buffer, to: { id: string, wrappedKey: Buffer, wrapIv: Buffer, wrapAuthTag: Buffer }[] }}
 */
export function encryptForRecipients(plaintext, { senderPrivateKey, recipients }) {
  if (!recipients || recipients.length === 0) {
    throw new Error('encryptForRecipients: at least one recipient is required');
  }
  const plaintextBuf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const contentKey = randomBytes(CONTENT_KEY_BYTES);
  const content = aesGcmEncrypt(contentKey, plaintextBuf);

  const to = recipients.map(({ id, publicKey }) => {
    const shared = ecdh(senderPrivateKey, publicKey);
    const wrapKey = sha256(shared);
    const wrap = aesGcmEncrypt(wrapKey, contentKey);
    return { id, wrappedKey: wrap.ciphertext, wrapIv: wrap.iv, wrapAuthTag: wrap.authTag };
  });

  return { iv: content.iv, ciphertext: content.ciphertext, authTag: content.authTag, to };
}

/**
 * Decrypt an encryptForRecipients() envelope as one of its recipients.
 *
 * @param {ReturnType<typeof encryptForRecipients>} envelope
 * @param {object} params
 * @param {string} params.recipientId
 * @param {import('node:crypto').KeyObject} params.recipientPrivateKey
 * @param {import('node:crypto').KeyObject} params.senderPublicKey
 * @returns {Buffer} the original plaintext
 */
export function decryptFromSender(envelope, { recipientId, recipientPrivateKey, senderPublicKey }) {
  const entry = envelope.to.find((r) => r.id === recipientId);
  if (!entry) {
    throw new Error(`decryptFromSender: no wrapped key for recipient '${recipientId}'`);
  }
  const shared = ecdh(recipientPrivateKey, senderPublicKey);
  const wrapKey = sha256(shared);
  const contentKey = aesGcmDecrypt(wrapKey, {
    iv: entry.wrapIv,
    ciphertext: entry.wrappedKey,
    authTag: entry.wrapAuthTag,
  });
  return aesGcmDecrypt(contentKey, { iv: envelope.iv, ciphertext: envelope.ciphertext, authTag: envelope.authTag });
}
