import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  generateX25519Keypair,
  x25519KeypairFromSeed,
  ecdh,
  sha256,
  encryptForRecipients,
  decryptFromSender,
} from '../src/crypto.js';

test('generateX25519Keypair produces usable KeyObjects', () => {
  const kp = generateX25519Keypair();
  assert.equal(kp.publicKey.asymmetricKeyType, 'x25519');
  assert.equal(kp.privateKey.asymmetricKeyType, 'x25519');
  assert.equal(kp.publicKeyRaw.length, 32);
  assert.equal(kp.privateKeyRaw.length, 32);
});

test('x25519KeypairFromSeed is deterministic', () => {
  const seed = randomBytes(32);
  const a = x25519KeypairFromSeed(seed);
  const b = x25519KeypairFromSeed(seed);
  assert.deepEqual(a.publicKeyRaw, b.publicKeyRaw);
  assert.deepEqual(a.privateKeyRaw, b.privateKeyRaw);
});

test('x25519KeypairFromSeed rejects a wrong-length seed', () => {
  assert.throws(() => x25519KeypairFromSeed(Buffer.alloc(16)));
});

test('different seeds produce different keys', () => {
  const a = x25519KeypairFromSeed(randomBytes(32));
  const b = x25519KeypairFromSeed(randomBytes(32));
  assert.notDeepEqual(a.publicKeyRaw, b.publicKeyRaw);
});

test('ecdh: both parties independently derive the same shared secret', () => {
  const alice = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const sharedByAlice = ecdh(alice.privateKey, bob.publicKey);
  const sharedByBob = ecdh(bob.privateKey, alice.publicKey);
  assert.deepEqual(sharedByAlice, sharedByBob);
});

test('sha256 is deterministic and matches a known vector', () => {
  const hash = sha256('abc');
  assert.equal(hash.toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('encryptForRecipients/decryptFromSender round-trips for a single recipient', () => {
  const sender = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const envelope = encryptForRecipients('hello bob', {
    senderPrivateKey: sender.privateKey,
    recipients: [{ id: 'bob', publicKey: bob.publicKey }],
  });
  const plaintext = decryptFromSender(envelope, {
    recipientId: 'bob',
    recipientPrivateKey: bob.privateKey,
    senderPublicKey: sender.publicKey,
  });
  assert.equal(plaintext.toString('utf8'), 'hello bob');
});

test('encryptForRecipients supports multiple recipients, each decrypting independently', () => {
  const sender = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const carol = generateX25519Keypair();
  const envelope = encryptForRecipients('group secret', {
    senderPrivateKey: sender.privateKey,
    recipients: [
      { id: 'bob', publicKey: bob.publicKey },
      { id: 'carol', publicKey: carol.publicKey },
    ],
  });

  const forBob = decryptFromSender(envelope, { recipientId: 'bob', recipientPrivateKey: bob.privateKey, senderPublicKey: sender.publicKey });
  const forCarol = decryptFromSender(envelope, { recipientId: 'carol', recipientPrivateKey: carol.privateKey, senderPublicKey: sender.publicKey });
  assert.equal(forBob.toString('utf8'), 'group secret');
  assert.equal(forCarol.toString('utf8'), 'group secret');
});

test('encryptForRecipients requires at least one recipient', () => {
  const sender = generateX25519Keypair();
  assert.throws(() => encryptForRecipients('x', { senderPrivateKey: sender.privateKey, recipients: [] }));
});

test('a recipient not in the envelope cannot decrypt', () => {
  const sender = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const eve = generateX25519Keypair();
  const envelope = encryptForRecipients('secret', {
    senderPrivateKey: sender.privateKey,
    recipients: [{ id: 'bob', publicKey: bob.publicKey }],
  });
  assert.throws(() =>
    decryptFromSender(envelope, { recipientId: 'eve', recipientPrivateKey: eve.privateKey, senderPublicKey: sender.publicKey }),
  );
});

test('the relay cannot decrypt with the wrong private key even knowing the recipient id', () => {
  const sender = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const attacker = generateX25519Keypair();
  const envelope = encryptForRecipients('secret', {
    senderPrivateKey: sender.privateKey,
    recipients: [{ id: 'bob', publicKey: bob.publicKey }],
  });
  assert.throws(() =>
    decryptFromSender(envelope, {
      recipientId: 'bob',
      recipientPrivateKey: attacker.privateKey, // wrong key
      senderPublicKey: sender.publicKey,
    }),
  );
});

test('tampering with the content ciphertext is detected (GCM auth tag)', () => {
  const sender = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const envelope = encryptForRecipients('secret', {
    senderPrivateKey: sender.privateKey,
    recipients: [{ id: 'bob', publicKey: bob.publicKey }],
  });
  envelope.ciphertext[0] ^= 0xff;
  assert.throws(() =>
    decryptFromSender(envelope, { recipientId: 'bob', recipientPrivateKey: bob.privateKey, senderPublicKey: sender.publicKey }),
  );
});

test('tampering with a wrapped key is detected', () => {
  const sender = generateX25519Keypair();
  const bob = generateX25519Keypair();
  const envelope = encryptForRecipients('secret', {
    senderPrivateKey: sender.privateKey,
    recipients: [{ id: 'bob', publicKey: bob.publicKey }],
  });
  envelope.to[0].wrappedKey[0] ^= 0xff;
  assert.throws(() =>
    decryptFromSender(envelope, { recipientId: 'bob', recipientPrivateKey: bob.privateKey, senderPublicKey: sender.publicKey }),
  );
});
