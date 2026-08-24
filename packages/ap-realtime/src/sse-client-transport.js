// Client-side SSE transport, read via a plain `fetch()` streaming body
// rather than the DOM `EventSource` API (not reliably available outside
// browsers), so this works identically in Node and in a browser client.

import { parseFrame } from './frame.js';

export class SseClientTransport {
  #url;
  #controller = null;
  #messageListeners = new Set();
  #closeListeners = new Set();

  /** @param {object} params @param {string} params.url */
  constructor({ url }) {
    if (!url) throw new Error('SseClientTransport: url is required');
    this.#url = url;
  }

  async connect() {
    this.#controller = new AbortController();
    const response = await fetch(this.#url, {
      headers: { accept: 'text/event-stream' },
      signal: this.#controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SseClientTransport: connect failed (${response.status})`);
    }
    this.#pump(response.body); // intentionally not awaited: runs for the connection's lifetime
  }

  async #pump(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.#handleChunk(chunk);
        }
      }
    } catch {
      // aborted via close(), or the connection dropped — either way falls through to onClose
    } finally {
      for (const callback of this.#closeListeners) callback();
    }
  }

  #handleChunk(chunk) {
    const dataLines = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) return; // a comment/ping line, e.g. ':ok'

    let frame;
    try {
      frame = parseFrame(dataLines.join('\n'));
    } catch {
      return;
    }
    for (const callback of this.#messageListeners) callback(frame);
  }

  send() {
    throw new Error('SseClientTransport.send: SSE is receive-only; publishing needs the HTTP inbox/outbox path');
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
    this.#controller?.abort();
  }

  getPeerId() {
    return null;
  }
}
