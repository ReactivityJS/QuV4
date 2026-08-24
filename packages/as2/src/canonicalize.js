// JSON Canonicalization Scheme (RFC 8785 — JCS). Produces a deterministic
// serialization of a JSON-compatible value so it can be hashed/signed
// consistently regardless of key order or incidental whitespace in the
// source document. This is the signing-input format for `qu:proof` and for
// content-addressing AS2 objects/activities.
//
// Rules implemented (per RFC 8785):
//   - object member names sorted by UTF-16 code unit sequence
//   - numbers serialized via the ECMAScript Number::toString algorithm
//     (i.e. JS's own `String(number)`), NaN/Infinity rejected
//   - strings escaped exactly as JSON.stringify already does (RFC 8785
//     defers to the same ECMAScript string-literal escaping)
//   - no insignificant whitespace

function canonicalizeValue(value) {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'boolean') return value ? 'true' : 'false';

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('JCS canonicalize: cannot serialize non-finite number');
    }
    return String(value);
  }

  if (type === 'string') return JSON.stringify(value);

  if (type === 'bigint') {
    throw new TypeError('JCS canonicalize: bigint is not a JSON type');
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? 'null' : canonicalizeValue(item)));
    return `[${items.join(',')}]`;
  }

  if (type === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key])}`);
    return `{${members.join(',')}}`;
  }

  throw new TypeError(`JCS canonicalize: unsupported type ${type}`);
}

/** Serialize `value` to its RFC 8785 canonical JSON string form. */
export function canonicalize(value) {
  return canonicalizeValue(value);
}

/** Same as canonicalize(), returned as UTF-8 bytes ready for hashing/signing. */
export function canonicalizeToBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}
