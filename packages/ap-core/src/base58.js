// Minimal base58btc (Bitcoin alphabet) codec, built from scratch — used by
// multikey encoding (did:key-style `z...` multibase strings). No external
// dependency, consistent with the repo-wide minimal-dependency policy.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map([...ALPHABET].map((char, index) => [char, index]));
const BASE = 58n;

export function base58Encode(bytes) {
  if (bytes.length === 0) return '';

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let out = '';
  while (value > 0n) {
    const remainder = value % BASE;
    value /= BASE;
    out = ALPHABET[Number(remainder)] + out;
  }

  // Preserve leading zero bytes as leading '1's, per base58 convention.
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = ALPHABET[0] + out;
  }

  return out;
}

export function base58Decode(str) {
  if (str.length === 0) return Buffer.alloc(0);

  let value = 0n;
  for (const char of str) {
    const digit = ALPHABET_MAP.get(char);
    if (digit === undefined) {
      throw new Error(`base58Decode: invalid character '${char}'`);
    }
    value = value * BASE + BigInt(digit);
  }

  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const bytes = hex.length > 0 ? Buffer.from(hex, 'hex') : Buffer.alloc(0);

  let leadingZeros = 0;
  for (const char of str) {
    if (char !== ALPHABET[0]) break;
    leadingZeros += 1;
  }

  return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
}
