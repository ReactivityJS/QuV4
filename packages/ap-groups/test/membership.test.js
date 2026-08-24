import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStoreAdapter } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { GroupMembership } from '../src/membership.js';

const GROUP_ID = 'https://relay.example/groups/friends';

function makeMembership() {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  return { store, membership: new GroupMembership({ store, groupId: GROUP_ID }) };
}

test('requires store and groupId', () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  assert.throws(() => new GroupMembership({ groupId: GROUP_ID }));
  assert.throws(() => new GroupMembership({ store }));
});

test('a new group has no members', async () => {
  const { membership } = makeMembership();
  assert.deepEqual(await membership.listMembers(), []);
  assert.equal(await membership.isMember('https://relay.example/actors/alice'), false);
});

test('addMember makes a member visible in isMember and listMembers', async () => {
  const { membership } = makeMembership();
  const alice = 'https://relay.example/actors/alice';
  await membership.addMember(alice);
  assert.equal(await membership.isMember(alice), true);
  assert.deepEqual(await membership.listMembers(), [alice]);
});

test('removeMember revokes membership', async () => {
  const { membership } = makeMembership();
  const alice = 'https://relay.example/actors/alice';
  await membership.addMember(alice);
  await membership.removeMember(alice);
  assert.equal(await membership.isMember(alice), false);
  assert.deepEqual(await membership.listMembers(), []);
});

test('multiple members are all tracked independently', async () => {
  const { membership } = makeMembership();
  const alice = 'https://relay.example/actors/alice';
  const bob = 'https://relay.example/actors/bob';
  await membership.addMember(alice);
  await membership.addMember(bob);
  const members = await membership.listMembers();
  assert.deepEqual(members.sort(), [alice, bob].sort());

  await membership.removeMember(alice);
  assert.deepEqual(await membership.listMembers(), [bob]);
});

test('membership records do not collide with the member actor id in the object store', async () => {
  const { store, membership } = makeMembership();
  const alice = 'https://relay.example/actors/alice';
  // Simulate a cached copy of Alice's own actor profile stored at her real id.
  await store.put({ id: alice, type: 'Person', name: 'Alice' });
  await membership.addMember(alice);

  // The membership record must not have clobbered Alice's profile object.
  const profile = await store.get(alice);
  assert.equal(profile.type, 'Person');
  assert.equal(profile.name, 'Alice');
  assert.equal(await membership.isMember(alice), true);
});

test('membership is scoped per group', async () => {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const groupA = new GroupMembership({ store, groupId: 'https://relay.example/groups/a' });
  const groupB = new GroupMembership({ store, groupId: 'https://relay.example/groups/b' });
  const alice = 'https://relay.example/actors/alice';

  await groupA.addMember(alice);
  assert.equal(await groupA.isMember(alice), true);
  assert.equal(await groupB.isMember(alice), false);
});
