import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeInfo, buildNodeInfoDiscovery } from '../src/nodeinfo.js';

test('buildNodeInfo fills in defaults', () => {
  const info = buildNodeInfo({ softwareName: 'quniverse', softwareVersion: '0.0.0' });
  assert.equal(info.version, '2.1');
  assert.deepEqual(info.protocols, ['activitypub']);
  assert.equal(info.usage.users.total, 0);
  assert.equal(info.openRegistration, false);
});

test('buildNodeInfo requires software name and version', () => {
  assert.throws(() => buildNodeInfo({ softwareVersion: '0.0.0' }));
  assert.throws(() => buildNodeInfo({ softwareName: 'quniverse' }));
});

test('buildNodeInfoDiscovery points at the given nodeinfo URL', () => {
  const discovery = buildNodeInfoDiscovery('https://relay.example/nodeinfo/2.1');
  assert.equal(discovery.links[0].href, 'https://relay.example/nodeinfo/2.1');
  assert.equal(discovery.links[0].rel, 'http://nodeinfo.diaspora.software/ns/schema/2.1');
});

test('buildNodeInfoDiscovery requires a url', () => {
  assert.throws(() => buildNodeInfoDiscovery());
});
