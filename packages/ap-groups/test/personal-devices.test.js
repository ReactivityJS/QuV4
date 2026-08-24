import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalDevicesGroupId } from '../src/personal-devices.js';

test('computes a deterministic, actor-scoped devices group id', () => {
  const actorId = 'https://relay.example/actors/alice';
  assert.equal(personalDevicesGroupId(actorId), 'https://relay.example/actors/alice/devices');
});

test('requires actorId', () => {
  assert.throws(() => personalDevicesGroupId());
});

test('different actors get different devices groups', () => {
  const a = personalDevicesGroupId('https://relay.example/actors/alice');
  const b = personalDevicesGroupId('https://relay.example/actors/bob');
  assert.notEqual(a, b);
});
