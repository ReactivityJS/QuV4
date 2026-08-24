// The sharpened encryption guard — docs/rewrite-plan.md's "Ergänzung":
// not just "encrypted + public -> throw" (the original rule), but also
// "private visibility (direct/group/self) AND not encrypted -> throw".
// Structurally enforces that private data can never leave a device or
// land on a relay unencrypted — meant to be called at the publish API
// boundary (see @qu/ap-client), not left to convention.

/**
 * @param {object} params
 * @param {boolean} params.isPublic
 * @param {boolean} params.encrypted
 * @param {boolean} [params.allowUnencryptedPrivate] - explicit, deliberately
 *   inconvenient opt-out for the rare legacy case the plan allows for.
 */
export function assertEncryptionGuard({ isPublic, encrypted, allowUnencryptedPrivate = false }) {
  if (isPublic && encrypted) {
    throw new Error('assertEncryptionGuard: a publicly-addressed document cannot also be encrypted');
  }
  if (!isPublic && !encrypted && !allowUnencryptedPrivate) {
    throw new Error(
      'assertEncryptionGuard: private visibility requires encryption — pass encryptFor to encrypt this ' +
        'publish, or the explicit allowUnencryptedPrivate:true opt-out if you really mean to publish ' +
        'unencrypted private data.',
    );
  }
}
