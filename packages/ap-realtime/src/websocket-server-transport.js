// Server-side WebSocket transport: many peers, one relay. Attaches to an
// *existing* node:http.Server (the same one ap-router.js's AP routes run
// on — see docs/rewrite-plan.md's QuRelay-is-one-process rule) rather than
// listening on its own port.

import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { parseFrame, serializeFrame } from './frame.js';

class PeerConnection {
  #ws;
  #peerId;

  constructor(ws, peerId) {
    this.#ws = ws;
    this.#peerId = peerId;
  }

  getPeerId() {
    return this.#peerId;
  }

  send(frame) {
    if (this.#ws.readyState !== this.#ws.OPEN) return;
    this.#ws.send(serializeFrame(frame));
  }

  onMessage(callback) {
    const handler = (data) => {
      let frame;
      try {
        frame = parseFrame(data.toString());
      } catch {
        return; // malformed frame, silently dropped
      }
      callback(frame);
    };
    this.#ws.on('message', handler);
    return () => this.#ws.off('message', handler);
  }

  onClose(callback) {
    this.#ws.on('close', callback);
    return () => this.#ws.off('close', callback);
  }

  close() {
    this.#ws.close();
  }
}

export class WebSocketServerTransport {
  #wss;
  #peers = new Map();
  #connectionListeners = new Set();

  /**
   * @param {object} params
   * @param {import('node:http').Server} params.server - an existing HTTP server to attach the WS upgrade to
   * @param {string} [params.path] - default '/realtime'
   */
  constructor({ server, path = '/realtime' }) {
    if (!server) throw new Error('WebSocketServerTransport: server is required');
    this.#wss = new WebSocketServer({ server, path });
    this.#wss.on('connection', (ws) => {
      const peerId = randomUUID();
      const peer = new PeerConnection(ws, peerId);
      this.#peers.set(peerId, peer);
      ws.on('close', () => this.#peers.delete(peerId));
      for (const callback of this.#connectionListeners) callback(peerId, peer);
    });
  }

  /** Called with (peerId, peerTransport) for every new connection. Returns an unsubscribe function. */
  onConnection(callback) {
    this.#connectionListeners.add(callback);
    return () => this.#connectionListeners.delete(callback);
  }

  sendTo(peerId, frame) {
    this.#peers.get(peerId)?.send(frame);
  }

  broadcast(frame, { except } = {}) {
    for (const [peerId, peer] of this.#peers) {
      if (peerId === except) continue;
      peer.send(frame);
    }
  }

  peerCount() {
    return this.#peers.size;
  }

  close() {
    for (const peer of this.#peers.values()) peer.close();
    this.#wss.close();
  }
}
