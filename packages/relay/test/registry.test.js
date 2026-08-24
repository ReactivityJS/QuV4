import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActorRegistry } from '../src/registry.js';

test('register makes a record findable by both username and actor id', () => {
  const registry = new ActorRegistry();
  const record = { username: 'alice', actor: { id: 'https://relay.example/actors/alice' } };
  registry.register(record);
  assert.equal(registry.byUsername('alice'), record);
  assert.equal(registry.byId('https://relay.example/actors/alice'), record);
});

test('unknown username/id return undefined', () => {
  const registry = new ActorRegistry();
  assert.equal(registry.byUsername('nobody'), undefined);
  assert.equal(registry.byId('https://relay.example/actors/nobody'), undefined);
});

test('registering a second actor keeps the first', () => {
  const registry = new ActorRegistry();
  registry.register({ username: 'alice', actor: { id: 'https://relay.example/actors/alice' } });
  registry.register({ username: 'bob', actor: { id: 'https://relay.example/actors/bob' } });
  assert.equal(registry.byUsername('alice').username, 'alice');
  assert.equal(registry.byUsername('bob').username, 'bob');
});
