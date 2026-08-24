// Bootstraps a single QuRelay-hosted actor from a LocalVault: the raw
// Ed25519 identity seed and the throwaway RSA transport keypair (§
// docs/rewrite-plan.md decision 5) are generated once and persisted in the
// vault, then used to build the actor's AS2 document.
//
// This intentionally stays single-actor-per-vault: full HD multi-actor
// identity (Main-/Space-Actors, packages/identity's SLIP-10 derivation) is
// its own future package, not yet built in QuV4. One relay process today
// hosts exactly the one actor its vault was seeded for.

import { randomBytes, createPrivateKey, createPublicKey } from 'node:crypto';
import { buildActor, ed25519KeypairFromSeed, generateRsaTransportKeypair } from '@qu/ap-core';

/**
 * @param {object} params
 * @param {import('@qu/local-vault').LocalVault} params.vault
 * @param {string} params.host - the relay's public hostname (used to build all actor URLs)
 * @param {string} params.username
 * @returns {Promise<{
 *   actor: object,
 *   username: string,
 *   keyId: string,
 *   privateKey: import('node:crypto').KeyObject,
 *   publicKey: import('node:crypto').KeyObject,
 *   edKeypair: object,
 * }>}
 */
export async function ensureLocalActor({ vault, host, username }) {
  if (!vault) throw new Error('ensureLocalActor: vault is required');
  if (!host) throw new Error('ensureLocalActor: host is required');
  if (!username) throw new Error('ensureLocalActor: username is required');

  let seed = await vault.getSeed();
  if (!seed) {
    seed = randomBytes(32);
    await vault.setSeed(seed);
  }
  const edKeypair = ed25519KeypairFromSeed(seed);

  let transportKeypair = await vault.getTransportKeypair();
  if (!transportKeypair) {
    const rsa = generateRsaTransportKeypair();
    transportKeypair = { publicKeyPem: rsa.publicKeyPem, privateKeyPem: rsa.privateKeyPem };
    await vault.setTransportKeypair(transportKeypair);
  }

  const base = `https://${host}/actors/${username}`;
  const actor = buildActor({
    id: base,
    preferredUsername: username,
    inbox: `${base}/inbox`,
    outbox: `${base}/outbox`,
    followers: `${base}/followers`,
    following: `${base}/following`,
    sharedInbox: `https://${host}/inbox`,
    publicKeyMultibase: edKeypair.publicKeyMultibase,
    rsaPublicKeyPem: transportKeypair.publicKeyPem,
  });

  return {
    actor,
    username,
    keyId: `${base}#transport-key`,
    privateKey: createPrivateKey(transportKeypair.privateKeyPem),
    publicKey: createPublicKey(transportKeypair.publicKeyPem),
    edKeypair,
  };
}
