import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInboxes } from '../src/resolve-inboxes.js';

function fakeFetchActor(actors) {
  return async (id) => {
    const actor = actors[id];
    if (!actor) throw new Error(`no such actor: ${id}`);
    return actor;
  };
}

test('resolves to each actor\'s direct inbox when no sharedInbox is advertised', async () => {
  const actors = {
    'https://a.example/actors/1': { id: 'https://a.example/actors/1', inbox: 'https://a.example/inbox/1' },
    'https://b.example/actors/2': { id: 'https://b.example/actors/2', inbox: 'https://b.example/inbox/2' },
  };
  const { inboxes, errors } = await resolveInboxes(Object.keys(actors), {
    fetchActorImpl: fakeFetchActor(actors),
  });
  assert.deepEqual(inboxes.sort(), ['https://a.example/inbox/1', 'https://b.example/inbox/2']);
  assert.deepEqual(errors, []);
});

test('collapses recipients sharing a sharedInbox into one delivery target', async () => {
  const actors = {
    'https://a.example/actors/1': {
      id: 'https://a.example/actors/1',
      inbox: 'https://a.example/inbox/1',
      endpoints: { sharedInbox: 'https://a.example/inbox' },
    },
    'https://a.example/actors/2': {
      id: 'https://a.example/actors/2',
      inbox: 'https://a.example/inbox/2',
      endpoints: { sharedInbox: 'https://a.example/inbox' },
    },
  };
  const { inboxes } = await resolveInboxes(Object.keys(actors), { fetchActorImpl: fakeFetchActor(actors) });
  assert.deepEqual(inboxes, ['https://a.example/inbox']);
});

test('collects per-recipient errors without failing the whole resolution', async () => {
  const actors = {
    'https://a.example/actors/1': { id: 'https://a.example/actors/1', inbox: 'https://a.example/inbox/1' },
  };
  const { inboxes, errors } = await resolveInboxes(
    ['https://a.example/actors/1', 'https://gone.example/actors/x'],
    { fetchActorImpl: fakeFetchActor(actors) },
  );
  assert.deepEqual(inboxes, ['https://a.example/inbox/1']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].id, 'https://gone.example/actors/x');
});

test('empty recipient list resolves to no inboxes', async () => {
  const { inboxes, errors } = await resolveInboxes([], { fetchActorImpl: fakeFetchActor({}) });
  assert.deepEqual(inboxes, []);
  assert.deepEqual(errors, []);
});
