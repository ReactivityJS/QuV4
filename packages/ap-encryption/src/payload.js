// qu:encryptedPayload — the AS2-shaped wire form of @qu/core's
// encryptForRecipients()/decryptFromSender(), with X25519 keys carried as
// Multikey strings so the payload is self-contained JSON, not raw buffers.

import { encryptForRecipients, decryptFromSender, x25519PublicKeyFromRaw } from '@qu/core';
import { encodeX25519Multikey, decodeX25519Multikey } from './x25519-multikey.js';

function toBase64(buf) {
  return buf.toString('base64');
}

function fromBase64(str) {
  return Buffer.from(str, 'base64');
}

/**
 * Encrypt `plaintext` into a qu:encryptedPayload document.
 *
 * @param {string} plaintext
 * @param {object} params
 * @param {import('node:crypto').KeyObject} params.senderPrivateKey
 * @param {string} params.senderPublicKeyMultibase
 * @param {{ id: string, publicKeyMultibase: string }[]} params.recipients
 */
export function encryptPayload(plaintext, { senderPrivateKey, senderPublicKeyMultibase, recipients }) {
  const envelope = encryptForRecipients(plaintext, {
    senderPrivateKey,
    recipients: recipients.map(({ id, publicKeyMultibase }) => ({
      id,
      publicKey: x25519PublicKeyFromRaw(decodeX25519Multikey(publicKeyMultibase)),
    })),
  });

  return {
    type: 'qu:EncryptedPayload',
    senderKey: senderPublicKeyMultibase,
    iv: toBase64(envelope.iv),
    ciphertext: toBase64(envelope.ciphertext),
    authTag: toBase64(envelope.authTag),
    to: envelope.to.map((r) => ({
      id: r.id,
      wrappedKey: toBase64(r.wrappedKey),
      wrapIv: toBase64(r.wrapIv),
      wrapAuthTag: toBase64(r.wrapAuthTag),
    })),
  };
}

/**
 * Decrypt a qu:encryptedPayload document as one of its recipients.
 *
 * @param {object} payload - as produced by encryptPayload()
 * @param {object} params
 * @param {string} params.recipientId
 * @param {import('node:crypto').KeyObject} params.recipientPrivateKey
 * @returns {string} the original plaintext
 */
export function decryptPayload(payload, { recipientId, recipientPrivateKey }) {
  const senderPublicKey = x25519PublicKeyFromRaw(decodeX25519Multikey(payload.senderKey));
  const envelope = {
    iv: fromBase64(payload.iv),
    ciphertext: fromBase64(payload.ciphertext),
    authTag: fromBase64(payload.authTag),
    to: payload.to.map((r) => ({
      id: r.id,
      wrappedKey: fromBase64(r.wrappedKey),
      wrapIv: fromBase64(r.wrapIv),
      wrapAuthTag: fromBase64(r.wrapAuthTag),
    })),
  };
  const plaintext = decryptFromSender(envelope, { recipientId, recipientPrivateKey, senderPublicKey });
  return plaintext.toString('utf8');
}
