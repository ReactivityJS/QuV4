// HTTP Signatures (draft-cavage-http-signatures, RSA-SHA256) — the outer
// signature envelope Mastodon and most of the fediverse expect on federated
// deliveries. Signed with the throwaway RSA transport key (see multikey.js
// / actor.js), never with the Ed25519 identity key.

import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

const DEFAULT_SIGNED_HEADERS = ['(request-target)', 'host', 'date', 'digest'];

function requestTargetLine(method, url) {
  const u = new URL(url);
  return `${method.toLowerCase()} ${u.pathname}${u.search}`;
}

function buildSigningString(method, url, headers, signedHeaderNames) {
  return signedHeaderNames
    .map((name) => {
      if (name === '(request-target)') return `(request-target): ${requestTargetLine(method, url)}`;
      const value = headers[name];
      if (value === undefined) {
        throw new Error(`buildSigningString: missing header '${name}' to sign`);
      }
      return `${name}: ${value}`;
    })
    .join('\n');
}

function digestHeaderFor(body) {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return `SHA-256=${createHash('sha256').update(buf).digest('base64')}`;
}

/**
 * Sign an outgoing request. Returns the full header set to send (original
 * headers plus host/date/digest as needed, plus Signature).
 *
 * @param {object} params
 * @param {string} params.method
 * @param {string} params.url - full request URL
 * @param {object} [params.headers] - headers already decided by the caller
 * @param {string|Buffer} [params.body] - request body, if any (adds Digest)
 * @param {string} params.keyId - the actor's `publicKey.id` (e.g. `${actorId}#transport-key`)
 * @param {import('node:crypto').KeyObject} params.privateKey - RSA private KeyObject
 * @param {string[]} [params.signedHeaderNames]
 */
export function signRequest({
  method,
  url,
  headers = {},
  body,
  keyId,
  privateKey,
  signedHeaderNames = DEFAULT_SIGNED_HEADERS,
}) {
  if (!method) throw new Error('signRequest: method is required');
  if (!url) throw new Error('signRequest: url is required');
  if (!keyId) throw new Error('signRequest: keyId is required');
  if (!privateKey) throw new Error('signRequest: privateKey is required');

  const u = new URL(url);
  const outHeaders = { ...headers };
  outHeaders.host ??= u.host;
  outHeaders.date ??= new Date().toUTCString();
  if (body !== undefined) {
    outHeaders.digest ??= digestHeaderFor(body);
  }

  const names = signedHeaderNames.filter(
    (name) => name === '(request-target)' || outHeaders[name] !== undefined,
  );
  const signingString = buildSigningString(method, url, outHeaders, names);
  const signature = cryptoSign('sha256', Buffer.from(signingString, 'utf8'), privateKey);

  outHeaders.signature =
    `keyId="${keyId}",algorithm="rsa-sha256",` +
    `headers="${names.join(' ')}",signature="${signature.toString('base64')}"`;

  return outHeaders;
}

function parseSignatureHeader(signatureHeader) {
  const params = {};
  const pattern = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(signatureHeader))) {
    params[match[1]] = match[2];
  }
  if (!params.keyId || !params.signature || !params.headers) {
    throw new Error('parseSignatureHeader: malformed Signature header');
  }
  return {
    keyId: params.keyId,
    algorithm: params.algorithm ?? 'rsa-sha256',
    signedHeaderNames: params.headers.split(' '),
    signature: Buffer.from(params.signature, 'base64'),
  };
}

/**
 * Verify an incoming request's Signature header.
 *
 * @param {object} params
 * @param {string} params.method
 * @param {string} params.url - full request URL as received
 * @param {object} params.headers - all received headers (lowercase keys), must include 'signature'
 * @param {string|Buffer} [params.body] - request body, to cross-check against Digest
 * @param {import('node:crypto').KeyObject} params.publicKey - the signer's RSA public KeyObject
 * @returns {boolean}
 */
export function verifyRequest({ method, url, headers, body, publicKey }) {
  if (!headers?.signature) return false;
  if (!publicKey) throw new Error('verifyRequest: publicKey is required');

  let parsed;
  try {
    parsed = parseSignatureHeader(headers.signature);
  } catch {
    return false;
  }

  if (headers.digest && body !== undefined) {
    if (headers.digest !== digestHeaderFor(body)) return false;
  }

  let signingString;
  try {
    signingString = buildSigningString(method, url, headers, parsed.signedHeaderNames);
  } catch {
    return false;
  }

  return cryptoVerify(
    'sha256',
    Buffer.from(signingString, 'utf8'),
    publicKey,
    parsed.signature,
  );
}

export { DEFAULT_SIGNED_HEADERS };
