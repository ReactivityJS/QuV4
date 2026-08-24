import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJoinActivity, buildAcceptActivity, buildLeaveActivity, buildRemoveActivity } from '../src/activities.js';

const ACTOR_BASE = 'https://relay.example/actors/alice';
const ACTOR_ID = ACTOR_BASE;
const GROUP_ID = 'https://relay.example/groups/friends';

test('buildJoinActivity: the requester is the actor, the group is the object', () => {
  const join = buildJoinActivity({ actorBase: ACTOR_BASE, actorId: ACTOR_ID, groupId: GROUP_ID });
  assert.equal(join.type, 'Join');
  assert.equal(join.actor, ACTOR_ID);
  assert.equal(join.object, GROUP_ID);
  assert.ok(join.id.startsWith(`${ACTOR_BASE}/activities/`));
});

test('buildAcceptActivity: the group is the actor, the Join is the object', () => {
  const join = buildJoinActivity({ actorBase: ACTOR_BASE, actorId: ACTOR_ID, groupId: GROUP_ID });
  const accept = buildAcceptActivity({ actorBase: GROUP_ID, groupId: GROUP_ID, joinActivity: join });
  assert.equal(accept.type, 'Accept');
  assert.equal(accept.actor, GROUP_ID);
  assert.equal(accept.object, join.id);
});

test('buildLeaveActivity mirrors buildJoinActivity', () => {
  const leave = buildLeaveActivity({ actorBase: ACTOR_BASE, actorId: ACTOR_ID, groupId: GROUP_ID });
  assert.equal(leave.type, 'Leave');
  assert.equal(leave.actor, ACTOR_ID);
  assert.equal(leave.object, GROUP_ID);
});

test('buildRemoveActivity: the group removes a member, targeting itself', () => {
  const remove = buildRemoveActivity({ actorBase: GROUP_ID, groupId: GROUP_ID, memberId: ACTOR_ID });
  assert.equal(remove.type, 'Remove');
  assert.equal(remove.actor, GROUP_ID);
  assert.equal(remove.object, ACTOR_ID);
  assert.equal(remove.target, GROUP_ID);
});

test('each call mints a distinct activity id', () => {
  const a = buildJoinActivity({ actorBase: ACTOR_BASE, actorId: ACTOR_ID, groupId: GROUP_ID });
  const b = buildJoinActivity({ actorBase: ACTOR_BASE, actorId: ACTOR_ID, groupId: GROUP_ID });
  assert.notEqual(a.id, b.id);
});
