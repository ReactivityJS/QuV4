// LocalVault: the only place the raw identity seed and the throwaway RSA
// transport private key are allowed to live. It is a plain KV store over a
// pluggable adapter (MemoryVaultAdapter, FsVaultAdapter, ...) — nothing in
// this package imports from ap-store/ap-delivery/ap-realtime, and nothing
// in those packages imports from here. That import boundary *is* the
// enforcement mechanism: a value that only ever passes through
// LocalVault's get/set has no code path into sync/delivery.
//
// See docs/rewrite-plan.md ("Identity-Anpassung"): this replaces QuV3's
// `LOCAL_ONLY_PREFIX` convention with a physically separate store instead
// of a path-prefix convention that code could accidentally bypass.

const SEED_KEY = 'identity-seed';
const TRANSPORT_KEYPAIR_KEY = 'transport-keypair';

export class LocalVault {
  #adapter;

  constructor(adapter) {
    if (!adapter) throw new Error('LocalVault: adapter is required');
    this.#adapter = adapter;
  }

  /** Raw BIP-39-derived seed bytes, or null if none is stored yet. */
  async getSeed() {
    const value = await this.#adapter.get(SEED_KEY);
    return value ?? null;
  }

  async setSeed(seed) {
    if (!Buffer.isBuffer(seed)) {
      throw new TypeError('LocalVault.setSeed: seed must be a Buffer');
    }
    await this.#adapter.set(SEED_KEY, seed);
  }

  /** The throwaway RSA-2048 transport keypair (PEM strings), or null. */
  async getTransportKeypair() {
    const value = await this.#adapter.get(TRANSPORT_KEYPAIR_KEY);
    return value ?? null;
  }

  async setTransportKeypair({ publicKeyPem, privateKeyPem }) {
    if (!publicKeyPem || !privateKeyPem) {
      throw new Error('LocalVault.setTransportKeypair: publicKeyPem and privateKeyPem are required');
    }
    await this.#adapter.set(TRANSPORT_KEYPAIR_KEY, { publicKeyPem, privateKeyPem });
  }

  /** Wipe everything this vault holds. */
  async clear() {
    await this.#adapter.delete(SEED_KEY);
    await this.#adapter.delete(TRANSPORT_KEYPAIR_KEY);
  }
}
