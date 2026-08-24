// A minimal in-memory Transport double for fast, deterministic ApClient
// unit tests. The real end-to-end proof (actual WebSocket, actual relay)
// lives in packages/relay/test/m2-two-tab-e2e.test.js.
export class FakeTransport {
  sent = [];
  connected = false;
  #messageListeners = new Set();
  #closeListeners = new Set();

  async connect() {
    this.connected = true;
  }

  send(frame) {
    if (!this.connected) throw new Error('FakeTransport.send: not connected');
    this.sent.push(frame);
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
    this.connected = false;
    for (const callback of this.#closeListeners) callback();
  }

  getPeerId() {
    return null;
  }

  // Test helpers, not part of the Transport interface:
  receive(frame) {
    for (const callback of this.#messageListeners) callback(frame);
  }

  simulateDrop() {
    this.connected = false;
    for (const callback of this.#closeListeners) callback();
  }
}
