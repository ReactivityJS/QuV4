// Server-side SSE transport — the "restrictive networks" alternative to
// WebSocket (docs/rewrite-plan.md § Realtime-Kanal). SSE is inherently
// receive-only, so this transport only ever pushes frames; a client using
// it for publish() still needs the regular HTTP inbox/outbox POST path,
// not this one.

import { randomUUID } from 'node:crypto';
import { serializeFrame } from './frame.js';

class SsePeerConnection {
  #res;
  #peerId;

  constructor(res, peerId) {
    this.#res = res;
    this.#peerId = peerId;
  }

  getPeerId() {
    return this.#peerId;
  }

  send(frame) {
    if (this.#res.writableEnded) return;
    this.#res.write(`data: ${serializeFrame(frame)}\n\n`);
  }

  onClose(callback) {
    this.#res.on('close', callback);
    return () => this.#res.off('close', callback);
  }

  close() {
    this.#res.end();
  }
}

export class SseServerTransport {
  #peers = new Map();
  #connectionListeners = new Set();

  /** Register `res` (an in-flight GET request's response) as a new SSE peer. */
  handleRequest(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(':ok\n\n');

    const peerId = randomUUID();
    const peer = new SsePeerConnection(res, peerId);
    this.#peers.set(peerId, peer);
    res.on('close', () => this.#peers.delete(peerId));
    for (const callback of this.#connectionListeners) callback(peerId, peer);
    return peer;
  }

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
  }
}
