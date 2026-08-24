// Thin `fetch` wrapper that adds the HTTP Signature envelope (RSA
// transport key) to outgoing federated requests. Uses the platform global
// `fetch` (available in Node ≥18) rather than pulling in an HTTP client
// dependency.

import { signRequest } from './http-signature.js';

/**
 * Perform a signed fetch.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method] - default 'GET'
 * @param {object} [options.headers]
 * @param {string|Buffer} [options.body]
 * @param {string} options.keyId - the actor's transport `publicKey.id`
 * @param {import('node:crypto').KeyObject} options.privateKey - RSA private KeyObject
 * @returns {Promise<Response>}
 */
export async function signedFetch(url, options = {}) {
  const { method = 'GET', headers = {}, body, keyId, privateKey, ...rest } = options;

  const signedHeaders = signRequest({ method, url, headers, body, keyId, privateKey });

  return fetch(url, {
    ...rest,
    method,
    headers: signedHeaders,
    body,
  });
}
