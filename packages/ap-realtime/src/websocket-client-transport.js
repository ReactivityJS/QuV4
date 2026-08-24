// Client-side WebSocket transport: one connection to the relay. This is
// the "Standard" transport per docs/rewrite-plan.md § Realtime-Kanal.

import WebSocket from 'ws';
import { parseFrame, serializeFrame } from './frame.js';

export class WebSocketClientTransport {
  #url;
  #ws = null;
  #messageListeners = new Set();
  #closeListeners = new Set();

  /** @param {object} params @param {string} params.url - ws:// or wss:// URL of the relay's realtime endpoint */
  constructor({ url }) {
    if (!url) throw new Error('WebSocketClientTransport: url is required');
    this.#url = url;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.#url);
      this.#ws = ws;

      const onOpen = () => {
        ws.off('error', onError);
        resolve();
      };
      const onError = (err) => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);

      ws.on('message', (data) => {
        let frame;
        try {
          frame = parseFrame(data.toString());
        } catch {
          return;
        }
        for (const callback of this.#messageListeners) callback(frame);
      });
      ws.on('close', () => {
        for (const callback of this.#closeListeners) callback();
      });
    });
  }

  send(frame) {
    if (!this.#ws || this.#ws.readyState !== this.#ws.OPEN) {
      throw new Error('WebSocketClientTransport.send: not connected');
    }
    this.#ws.send(serializeFrame(frame));
  }

  onMessage(callback) {
    this.#messageListeners.add(callback);
    return () => this.#messageListeners.delete(callback);
  }

  onClose(callback) {
    this.#closeListeners.add(callback);
    return () => this.#closeListeners.delete(callback);
  }

  close() {
    this.#ws?.close();
  }

  /** Reserved: a future auth handshake may have the relay assign a stable peer id. */
  getPeerId() {
    return null;
  }
}
