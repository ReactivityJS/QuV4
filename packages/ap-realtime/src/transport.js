// The generic Transport interface (ported from QuV3's
// packages/sync/src/transport.js design — see docs/rewrite-plan.md
// "Kritische Dateien"). Every concrete transport (WebSocket, SSE, later
// Web Push) implements this same shape, so ap-client and the relay's
// realtime bridge never know which one they're talking to.
//
// Client-side transports (one relay peer) implement:
//   connect(): Promise<void>
//   send(frame): void                 — send a frame to the relay
//   onMessage(cb: (frame) => void): () => void
//   onClose(cb: () => void): () => void
//   close(): void
//   getPeerId(): string | null        — this connection's relay-assigned peer id, once connected
//
// Server-side transports (many connected peers) implement the same
// send/onMessage/onClose/close surface *per peer*, plus:
//   onConnection(cb: (peerId, transport) => void): () => void
//   sendTo(peerId, frame): void
//   broadcast(frame, { except }?): void
//
// This file holds the documented contract and a runtime shape-check
// (assertTransport) used by tests and by anything that accepts an
// injected transport — there is deliberately no base class to extend,
// matching QuV3's duck-typed original.

const CLIENT_METHODS = ['connect', 'send', 'onMessage', 'onClose', 'close', 'getPeerId'];
const SERVER_METHODS = ['onConnection', 'sendTo', 'broadcast', 'close'];

function missingMethods(transport, methods) {
  return methods.filter((name) => typeof transport?.[name] !== 'function');
}

/** Throws with a clear message if `transport` doesn't implement the client-side Transport shape. */
export function assertClientTransport(transport) {
  const missing = missingMethods(transport, CLIENT_METHODS);
  if (missing.length > 0) {
    throw new TypeError(`assertClientTransport: missing method(s): ${missing.join(', ')}`);
  }
}

/** Throws with a clear message if `transport` doesn't implement the server-side Transport shape. */
export function assertServerTransport(transport) {
  const missing = missingMethods(transport, SERVER_METHODS);
  if (missing.length > 0) {
    throw new TypeError(`assertServerTransport: missing method(s): ${missing.join(', ')}`);
  }
}
