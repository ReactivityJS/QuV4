import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActor } from '../src/actor.js';
import { generateEd25519Keypair, generateRsaTransportKeypair } from '../src/multikey.js';

function makeParams(overrides = {}) {
  const ed = generateEd25519Keypair();
  const rsa = generateRsaTransportKeypair();
  return {
    id: 'https://relay.example/actors/alice',
    preferredUsername: 'alice',
    inbox: 'https://relay.example/actors/alice/inbox',
    outbox: 'https://relay.example/actors/alice/outbox',
    publicKeyMultibase: ed.publicKeyMultibase,
    rsaPublicKeyPem: rsa.publicKeyPem,
    ...overrides,
  };
}

test('builds a well-formed AS2 actor with both key roles', () => {
  const actor = buildActor(makeParams());
  assert.equal(actor.type, 'Person');
  assert.equal(actor.id, 'https://relay.example/actors/alice');
  assert.equal(actor.inbox, 'https://relay.example/actors/alice/inbox');
  assert.equal(actor.publicKey.owner, actor.id);
  assert.ok(actor.publicKey.publicKeyPem.includes('BEGIN PUBLIC KEY'));
  assert.equal(actor.assertionMethod[0].type, 'Multikey');
  assert.equal(actor.assertionMethod[0].controller, actor.id);
  assert.ok(actor.assertionMethod[0].publicKeyMultibase.startsWith('z'));
});

test('defaults optional fields absent', () => {
  const actor = buildActor(makeParams());
  assert.equal('followers' in actor, false);
  assert.equal('endpoints' in actor, false);
});

test('includes sharedInbox under endpoints when given', () => {
  const actor = buildActor(makeParams({ sharedInbox: 'https://relay.example/inbox' }));
  assert.equal(actor.endpoints.sharedInbox, 'https://relay.example/inbox');
});

test('rejects an unknown actor type', () => {
  assert.throws(() => buildActor(makeParams({ type: 'Robot' })));
});

test('requires id, inbox, outbox and both keys', () => {
  const base = makeParams();
  for (const field of ['id', 'inbox', 'outbox', 'publicKeyMultibase', 'rsaPublicKeyPem']) {
    const params = { ...base, [field]: undefined };
    assert.throws(() => buildActor(params), new RegExp(field));
  }
});
