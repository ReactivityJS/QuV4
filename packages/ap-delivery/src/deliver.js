// One-shot delivery attempt: POST a signed activity to a set of inbox
// URLs. Does not retry — that's DeliveryQueue's job. Every inbox is
// attempted independently, so one failure doesn't block the rest.

import { signedFetch } from '@qu/ap-core';

/**
 * @param {object} activity - the AS2 activity to deliver
 * @param {object} params
 * @param {string[]} params.inboxes
 * @param {string} params.keyId
 * @param {import('node:crypto').KeyObject} params.privateKey
 * @param {Function} [params.fetchImpl] - injectable, default signedFetch from @qu/ap-core
 * @returns {Promise<{ inbox: string, ok: boolean, status?: number, error?: string }[]>}
 */
export async function deliverActivity(activity, { inboxes, keyId, privateKey, fetchImpl = signedFetch }) {
  const rawBody = JSON.stringify(activity);
  const results = [];

  for (const inbox of inboxes) {
    try {
      const response = await fetchImpl(inbox, {
        method: 'POST',
        body: rawBody,
        headers: { 'content-type': 'application/activity+json' },
        keyId,
        privateKey,
      });
      results.push({ inbox, ok: response.ok, status: response.status });
    } catch (err) {
      results.push({ inbox, ok: false, error: err.message });
    }
  }

  return results;
}
