// Milestone M3's second half (docs/rewrite-plan.md's Verification
// section): "Profil-Einstellung auf Gerät A geändert erscheint
// verschlüsselt auf Gerät B, UND das Relay kann den Klartext nicht lesen."
// Two ApClients ("device A" and "device B") registered as members of
// alice's personal devices group (@qu/ap-groups), each with its own
// locally-generated X25519 keypair. Device A changes a private setting,
// encrypted for both devices; it arrives on device B over the real
// realtime channel and decrypts correctly there — while the relay's own
// authoritative store, and device B's local copy before it decrypts,
// both only ever hold ciphertext.
//
// Honest scope note (see README.md "Known gaps" and
// packages/ap-groups/src/personal-devices.js): both "devices" here
// authenticate to the realtime channel as the same AP actor id — per-
// device AP identity isn't built yet. What *is* genuinely per-device is
// the encryption key: each device generates and holds its own X25519
// keypair, exactly as it would with real per-device identity, so the
// encryption half of this milestone is not a simplification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStoreAdapter, QuEvents, generateX25519Keypair } from '@qu/core';
import { ApStore } from '@qu/ap-store';
import { LocalVault, MemoryVaultAdapter } from '@qu/local-vault';
import { WebSocketClientTransport } from '@qu/ap-realtime';
import { ApClient } from '@qu/ap-client';
import { GroupMembership, personalDevicesGroupId } from '@qu/ap-groups';
import { encodeX25519Multikey, decryptPayload } from '@qu/ap-encryption';
import { ensureLocalActor } from '../src/local-actor.js';
import { ActorRegistry } from '../src/registry.js';
import { createRealtimeBridge } from '../src/realtime-bridge.js';

async function startRelay() {
  const relayEvents = new QuEvents();
  const relayStore = new ApStore({ adapter: new MemoryStoreAdapter(), events: relayEvents });
  const vault = new LocalVault(new MemoryVaultAdapter());

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;

  const alice = await ensureLocalActor({ vault, host, username: 'alice' });
  const registry = new ActorRegistry();
  registry.register(alice);

  const bridge = createRealtimeBridge({ server, store: relayStore, events: relayEvents, registry });

  return {
    store: relayStore,
    actor: alice.actor,
    wsUrl: `ws://${host}/realtime`,
    close: async () => {
      bridge.close();
      server.close();
      await once(server, 'close');
    },
  };
}

function openDevice(wsUrl, actorId) {
  const store = new ApStore({ adapter: new MemoryStoreAdapter() });
  const transport = new WebSocketClientTransport({ url: wsUrl });
  const client = new ApClient({ store, transport, actorId });
  const x25519 = generateX25519Keypair();
  return {
    store,
    client,
    encryptionKeypair: { privateKey: x25519.privateKey, publicKeyMultibase: encodeX25519Multikey(x25519.publicKeyRaw) },
  };
}

test('M3: an encrypted profile setting changed on device A arrives correctly decrypted on device B; the relay never sees plaintext', async () => {
  const relay = await startRelay();
  const devicesGroupId = personalDevicesGroupId(relay.actor.id);
  const settings = `${relay.actor.id}/settings`;

  const deviceA = openDevice(relay.wsUrl, relay.actor.id);
  const deviceB = openDevice(relay.wsUrl, relay.actor.id);
  const deviceAId = `${relay.actor.id}/devices/device-a`;
  const deviceBId = `${relay.actor.id}/devices/device-b`;

  // Register both devices in alice's personal devices group, on the
  // relay's own authoritative store — the source of truth for who a
  // future device-group encryption should include.
  const membership = new GroupMembership({ store: relay.store, groupId: devicesGroupId });
  await membership.addMember(deviceAId);
  await membership.addMember(deviceBId);

  try {
    await deviceA.client.connect();
    await deviceB.client.connect();
    deviceB.client.subscribe(settings);
    await sleep(20);

    const recipients = [
      { id: deviceAId, publicKeyMultibase: deviceA.encryptionKeypair.publicKeyMultibase },
      { id: deviceBId, publicKeyMultibase: deviceB.encryptionKeypair.publicKeyMultibase },
    ];

    const settingId = `${relay.actor.id}/settings/theme`;
    const published = await deviceA.client.publish({
      id: settingId,
      type: 'qu:Setting',
      fields: { key: 'theme', value: 'dark-mode-forever' },
      visibility: devicesGroupId,
      collections: [settings],
      encryptFor: recipients,
      senderKeypair: deviceA.encryptionKeypair,
    });

    assert.equal(published.encrypted, true);
    assert.equal('value' in published, false);
    await sleep(40);

    // 1. The relay's own authoritative store: ciphertext only.
    const onRelay = await relay.store.get(settingId);
    assert.equal(onRelay.encrypted, true);
    assert.equal(JSON.stringify(onRelay).includes('dark-mode-forever'), false);

    // 2. Device B received it over the real realtime channel; its local
    //    copy — *before* anyone decrypts anything — is equally opaque.
    const onDeviceB = await deviceB.store.get(settingId);
    assert.ok(onDeviceB, 'device B should have received the change live');
    assert.equal(onDeviceB.encrypted, true);
    assert.equal(JSON.stringify(onDeviceB).includes('dark-mode-forever'), false);

    // 3. Device B decrypts with its own key and gets the real value.
    const plaintextOnB = JSON.parse(
      decryptPayload(onDeviceB.encryptedPayload, { recipientId: deviceBId, recipientPrivateKey: deviceB.encryptionKeypair.privateKey }),
    );
    assert.equal(plaintextOnB.value, 'dark-mode-forever');

    // 4. Device A can also decrypt its own write back (it encrypted for
    //    itself too, as any multi-device sync must).
    const plaintextOnA = JSON.parse(
      decryptPayload(onDeviceB.encryptedPayload, { recipientId: deviceAId, recipientPrivateKey: deviceA.encryptionKeypair.privateKey }),
    );
    assert.equal(plaintextOnA.value, 'dark-mode-forever');

    // 5. The relay operator, even holding the full document, cannot
    //    decrypt it — it has no recipient's private key at all. Simulate
    //    with a random keypair standing in for "anyone who isn't a
    //    registered device".
    const outsider = generateX25519Keypair();
    assert.throws(() =>
      decryptPayload(onRelay.encryptedPayload, {
        recipientId: deviceAId, // even knowing a valid recipient id doesn't help without their key
        recipientPrivateKey: outsider.privateKey,
      }),
    );
  } finally {
    deviceA.client.close();
    deviceB.client.close();
    await relay.close();
  }
});
