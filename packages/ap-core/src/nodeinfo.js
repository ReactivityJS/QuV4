// NodeInfo (2.0/2.1) document + `.well-known/nodeinfo` discovery building,
// so a QuRelay instance can be identified/introspected by other fediverse
// software the same way Mastodon/Lemmy/etc. instances are.

const SCHEMA_BASE = 'http://nodeinfo.diaspora.software/ns/schema/';

/** Build the `.well-known/nodeinfo` discovery document pointing at the real NodeInfo URL. */
export function buildNodeInfoDiscovery(nodeInfoUrl, version = '2.1') {
  if (!nodeInfoUrl) throw new Error('buildNodeInfoDiscovery: nodeInfoUrl is required');
  return {
    links: [
      {
        rel: `${SCHEMA_BASE}${version}`,
        href: nodeInfoUrl,
      },
    ],
  };
}

/**
 * Build a NodeInfo document.
 *
 * @param {object} params
 * @param {string} [params.version] - NodeInfo schema version, default '2.1'
 * @param {string} params.softwareName
 * @param {string} params.softwareVersion
 * @param {string[]} [params.protocols] - default ['activitypub']
 * @param {number} [params.totalUsers]
 * @param {number} [params.activeMonthUsers]
 * @param {number} [params.activeHalfyearUsers]
 * @param {number} [params.localPosts]
 * @param {number} [params.localComments]
 * @param {boolean} [params.openRegistration]
 * @param {object} [params.metadata]
 */
export function buildNodeInfo({
  version = '2.1',
  softwareName,
  softwareVersion,
  protocols = ['activitypub'],
  totalUsers = 0,
  activeMonthUsers = 0,
  activeHalfyearUsers = 0,
  localPosts = 0,
  localComments = 0,
  openRegistration = false,
  metadata = {},
}) {
  if (!softwareName) throw new Error('buildNodeInfo: softwareName is required');
  if (!softwareVersion) throw new Error('buildNodeInfo: softwareVersion is required');

  return {
    version,
    software: {
      name: softwareName,
      version: softwareVersion,
    },
    protocols,
    services: { inbound: [], outbound: [] },
    usage: {
      users: {
        total: totalUsers,
        activeMonth: activeMonthUsers,
        activeHalfyear: activeHalfyearUsers,
      },
      localPosts,
      localComments,
    },
    openRegistration,
    metadata,
  };
}
