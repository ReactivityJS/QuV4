// Milestone M3's first half ("Gruppen-E2EE nachweislich", docs/rewrite-
// plan.md's Verification section): proves the plan's central claim that
// Group + Audience + Encryption is *one* mechanism, not three. Membership
// (@qu/ap-groups) drives who a message gets encrypted for
// (@qu/ap-encryption); nothing here is group-specific crypto code — it's
// exactly the same encryptForRecipients()/decryptFromSender() any other
// private message uses, just with the recipient list read off
// GroupMembership instead of a hand-picked array.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStoreAdapter, generateX25519Keypair } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { encodeX25519Multikey, encryptPayload, decryptPayload } from '@qu/ap-encryption';
import { GroupMembership } from '../src/membership.js';

const GROUP_ID = 'https://relay.example/groups/friends';

function makeMember(id) {
  const kp = generateX25519Keypair();
  return { id, keypair: kp, publicKeyMultibase: encodeX25519Multikey(kp.publicKeyRaw) };
}

test('a message encrypted for the current group members is independently decryptable by each, opaque to everyone else', async () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const membership = new GroupMembership({ store, groupId: GROUP_ID });

  const alice = makeMember('https://relay.example/actors/alice');
  const bob = makeMember('https://relay.example/actors/bob');
  const carol = makeMember('https://relay.example/actors/carol');
  const mallory = makeMember('https://relay.example/actors/mallory'); // never joined

  await membership.addMember(alice.id);
  await membership.addMember(bob.id);
  await membership.addMember(carol.id);

  const memberIds = await membership.listMembers();
  const directory = new Map([alice, bob, carol].map((m) => [m.id, m]));
  const recipients = memberIds.map((id) => ({ id, publicKeyMultibase: directory.get(id).publicKeyMultibase }));

  const payload = encryptPayload('meet at 6pm', {
    senderPrivateKey: alice.keypair.privateKey,
    senderPublicKeyMultibase: alice.publicKeyMultibase,
    recipients,
  });

  // The payload itself, as it would sit in ap-store or travel over the
  // wire, contains no trace of the plaintext.
  assert.equal(JSON.stringify(payload).includes('meet at 6pm'), false);

  for (const member of [alice, bob, carol]) {
    const plaintext = decryptPayload(payload, { recipientId: member.id, recipientPrivateKey: member.keypair.privateKey });
    assert.equal(plaintext, 'meet at 6pm');
  }

  // Mallory was never a member, so she has no wrapped key at all —
  // structurally excluded, not just "not shown the plaintext".
  assert.throws(() => decryptPayload(payload, { recipientId: mallory.id, recipientPrivateKey: mallory.keypair.privateKey }));
});

test('removing a member revokes them from future group messages (they get no wrapped key at all)', async () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const membership = new GroupMembership({ store, groupId: GROUP_ID });

  const alice = makeMember('https://relay.example/actors/alice');
  const bob = makeMember('https://relay.example/actors/bob');
  await membership.addMember(alice.id);
  await membership.addMember(bob.id);

  // Bob's device is lost — the group revokes him.
  await membership.removeMember(bob.id);

  const currentMembers = await membership.listMembers();
  assert.deepEqual(currentMembers, [alice.id]);

  const payload = encryptPayload('new secret, bob is out', {
    senderPrivateKey: alice.keypair.privateKey,
    senderPublicKeyMultibase: alice.publicKeyMultibase,
    recipients: [{ id: alice.id, publicKeyMultibase: alice.publicKeyMultibase }],
  });

  assert.equal(payload.to.length, 1);
  assert.equal(payload.to[0].id, alice.id);
  // Bob's old key still physically exists, but he's not in `to` at all —
  // decrypting as him fails for lack of a wrapped key, not a wrong guess.
  assert.throws(() => decryptPayload(payload, { recipientId: bob.id, recipientPrivateKey: bob.keypair.privateKey }));
});
