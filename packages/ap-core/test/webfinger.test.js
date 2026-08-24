import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAcct,
  buildAcct,
  buildWebFingerResource,
  buildWebFingerRequestUrl,
  actorUrlFromWebFinger,
} from '../src/webfinger.js';

test('buildAcct / parseAcct round-trip', () => {
  const resource = buildAcct('alice', 'relay.example');
  assert.equal(resource, 'acct:alice@relay.example');
  assert.deepEqual(parseAcct(resource), { username: 'alice', host: 'relay.example' });
});

test('parseAcct returns null for malformed input', () => {
  assert.equal(parseAcct('not-an-acct'), null);
});

test('buildWebFingerResource produces a valid JRD', () => {
  const jrd = buildWebFingerResource({
    username: 'alice',
    host: 'relay.example',
    actorUrl: 'https://relay.example/actors/alice',
  });
  assert.equal(jrd.subject, 'acct:alice@relay.example');
  assert.deepEqual(jrd.aliases, ['https://relay.example/actors/alice']);
  assert.deepEqual(jrd.links, [
    { rel: 'self', type: 'application/activity+json', href: 'https://relay.example/actors/alice' },
  ]);
});

test('buildWebFingerRequestUrl encodes the resource parameter', () => {
  const url = buildWebFingerRequestUrl('relay.example', 'alice');
  assert.equal(
    url,
    'https://relay.example/.well-known/webfinger?resource=acct%3Aalice%40relay.example',
  );
});

test('actorUrlFromWebFinger extracts the self/activity+json link', () => {
  const jrd = buildWebFingerResource({
    username: 'alice',
    host: 'relay.example',
    actorUrl: 'https://relay.example/actors/alice',
  });
  assert.equal(actorUrlFromWebFinger(jrd), 'https://relay.example/actors/alice');
});

test('actorUrlFromWebFinger returns null when no matching link', () => {
  assert.equal(actorUrlFromWebFinger({ links: [] }), null);
  assert.equal(actorUrlFromWebFinger({}), null);
});
