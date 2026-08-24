import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupActor } from '../src/group-actor.js';
import { generateEd25519Keypair, generateRsaTransportKeypair } from '@qu/ap-core';

function makeParams(overrides = {}) {
  const ed = generateEd25519Keypair();
  const rsa = generateRsaTransportKeypair();
  return {
    id: 'https://relay.example/groups/friends',
    inbox: 'https://relay.example/groups/friends/inbox',
    outbox: 'https://relay.example/groups/friends/outbox',
    followers: 'https://relay.example/groups/friends/followers',
    publicKeyMultibase: ed.publicKeyMultibase,
    rsaPublicKeyPem: rsa.publicKeyPem,
    ...overrides,
  };
}

test('builds a Group-typed actor', () => {
  const group = buildGroupActor(makeParams());
  assert.equal(group.type, 'Group');
  assert.equal(group.id, 'https://relay.example/groups/friends');
});

test('an explicit type in params cannot override Group', () => {
  const group = buildGroupActor(makeParams({ type: 'Person' }));
  assert.equal(group.type, 'Group');
});

test('still requires the same keys any actor needs', () => {
  assert.throws(() => buildGroupActor(makeParams({ publicKeyMultibase: undefined })));
});
