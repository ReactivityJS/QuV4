import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAudience, isPublicAudience, stripBlindAddressing } from '../src/audience.js';
import { PUBLIC_AUDIENCE } from '../src/vocabulary.js';

test('normalizes single-string fields into arrays', () => {
  const n = normalizeAudience({ to: 'https://a/actor', cc: 'https://b/actor' });
  assert.deepEqual(n.to, ['https://a/actor']);
  assert.deepEqual(n.cc, ['https://b/actor']);
});

test('accepts embedded objects with an id', () => {
  const n = normalizeAudience({ to: { id: 'https://a/actor', type: 'Person' } });
  assert.deepEqual(n.to, ['https://a/actor']);
});

test('deduplicates within a field and across recipients', () => {
  const n = normalizeAudience({ to: ['https://a', 'https://a'], cc: ['https://a'] });
  assert.deepEqual(n.to, ['https://a']);
  assert.deepEqual(n.cc, ['https://a']);
  assert.deepEqual(n.recipients, ['https://a']);
});

test('detects public addressing and excludes it from recipients', () => {
  const n = normalizeAudience({ to: [PUBLIC_AUDIENCE, 'https://a'] });
  assert.equal(n.public, true);
  assert.deepEqual(n.recipients, ['https://a']);
  assert.equal(isPublicAudience({ cc: PUBLIC_AUDIENCE }), true);
});

test('missing addressing fields normalize to empty, non-public', () => {
  const n = normalizeAudience({});
  assert.equal(n.public, false);
  assert.deepEqual(n.recipients, []);
  for (const field of ['to', 'cc', 'bto', 'bcc', 'audience']) {
    assert.deepEqual(n[field], []);
  }
});

test('recipients is the union of to/cc/bto/bcc/audience', () => {
  const n = normalizeAudience({
    to: ['https://a'],
    cc: ['https://b'],
    bto: ['https://c'],
    bcc: ['https://d'],
    audience: ['https://e'],
  });
  assert.deepEqual(
    n.recipients.sort(),
    ['https://a', 'https://b', 'https://c', 'https://d', 'https://e'].sort(),
  );
});

test('stripBlindAddressing removes bto/bcc but keeps everything else', () => {
  const stripped = stripBlindAddressing({
    id: 'x',
    to: ['https://a'],
    bto: ['https://b'],
    bcc: ['https://c'],
  });
  assert.equal('bto' in stripped, false);
  assert.equal('bcc' in stripped, false);
  assert.deepEqual(stripped.to, ['https://a']);
  assert.equal(stripped.id, 'x');
});
