import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertEncryptionGuard } from '../src/guard.js';

test('public + unencrypted passes', () => {
  assert.doesNotThrow(() => assertEncryptionGuard({ isPublic: true, encrypted: false }));
});

test('private + encrypted passes', () => {
  assert.doesNotThrow(() => assertEncryptionGuard({ isPublic: false, encrypted: true }));
});

test('public + encrypted throws (a public document cannot also be encrypted)', () => {
  assert.throws(() => assertEncryptionGuard({ isPublic: true, encrypted: true }), /publicly-addressed/);
});

test('private + unencrypted throws by default (the sharpened rule)', () => {
  assert.throws(() => assertEncryptionGuard({ isPublic: false, encrypted: false }), /requires encryption/);
});

test('private + unencrypted is allowed only with the explicit, inconvenient opt-out', () => {
  assert.doesNotThrow(() =>
    assertEncryptionGuard({ isPublic: false, encrypted: false, allowUnencryptedPrivate: true }),
  );
});

test('the opt-out does not affect the public+encrypted contradiction', () => {
  assert.throws(() =>
    assertEncryptionGuard({ isPublic: true, encrypted: true, allowUnencryptedPrivate: true }),
  );
});
