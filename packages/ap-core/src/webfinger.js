// WebFinger (RFC 7033) resource building/parsing — the discovery step that
// turns `acct:user@host` into an actor URL, needed for Mastodon-style
// federation handles.

const ACCT_PATTERN = /^acct:([^@]+)@(.+)$/;

/** Parse an `acct:user@host` resource string. Returns null if malformed. */
export function parseAcct(resource) {
  const match = ACCT_PATTERN.exec(resource);
  if (!match) return null;
  return { username: match[1], host: match[2] };
}

/** Build the `acct:` resource string for a username@host handle. */
export function buildAcct(username, host) {
  if (!username || !host) throw new Error('buildAcct: username and host are required');
  return `acct:${username}@${host}`;
}

/**
 * Build a WebFinger JRD (RFC 7033 §4.4) resolving `acct:user@host` to an
 * actor URL.
 */
export function buildWebFingerResource({ username, host, actorUrl, aliases = [] }) {
  if (!username || !host) throw new Error('buildWebFingerResource: username and host are required');
  if (!actorUrl) throw new Error('buildWebFingerResource: actorUrl is required');

  return {
    subject: buildAcct(username, host),
    aliases: [actorUrl, ...aliases],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actorUrl,
      },
    ],
  };
}

/** Build the `.well-known/webfinger` request URL for a handle on `host`. */
export function buildWebFingerRequestUrl(host, username, resourceHost = host) {
  const resource = buildAcct(username, resourceHost);
  return `https://${host}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`;
}

/** Extract the actor URL (rel=self, activity+json) from a WebFinger JRD. */
export function actorUrlFromWebFinger(jrd) {
  const link = (jrd?.links ?? []).find(
    (entry) => entry.rel === 'self' && entry.type === 'application/activity+json',
  );
  return link?.href ?? null;
}
