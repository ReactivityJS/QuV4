// qu:StreamFrame — the one wire envelope for the realtime channel (see
// docs/rewrite-plan.md § Realtime-Kanal): a single frame shape with a
// `kind` discriminator, replacing what used to be two parallel formats
// (QuBit sync frames vs. AS2 activities). Every frame — data or control —
// goes through this one envelope.
//
//   data frames    kind: 'object' | 'activity' | 'ephemeral' | 'session'
//                  { kind, id, doc, collections, durability, sessionId? }
//   control frames kind: 'control'
//                  { kind: 'control', op, ...opFields }
//
// Control ops: 'resume' (client -> server, qu:Resume{since}), 'resumed'
// (server -> client, replay complete + the cursor to resume from next
// time), 'subscribe' / 'unsubscribe' (client -> server, a collection id).

import { DURABILITY, ACTIVITY_TYPES } from '@qu/as2';
import { encodeCursor } from '@qu/core';

export const FRAME_KINDS = Object.freeze(['object', 'activity', 'ephemeral', 'session', 'control']);
const DATA_KINDS = new Set(['object', 'activity', 'ephemeral', 'session']);

export const CONTROL_OP = Object.freeze({
  // Sent first, by the client, right after connect: identifies which
  // actor this peer represents. Kept out of the transport layer itself
  // (transports stay actor-agnostic) and handled by whatever wires a
  // transport to a store — e.g. packages/relay's realtime bridge.
  HELLO: 'hello',
  RESUME: 'resume',
  RESUMED: 'resumed',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
});

/** Which data `kind` a persistent ap-store change corresponds to: 'activity' for AS2 activity types, 'object' otherwise. */
export function persistentFrameKind(doc) {
  return doc && ACTIVITY_TYPES.includes(doc.type) ? 'activity' : 'object';
}

/** Map an ap-store onChange() event to the StreamFrame kind it belongs on. */
export function frameKindForChange({ doc, durability }) {
  if (durability === DURABILITY.EPHEMERAL) return 'ephemeral';
  if (durability === DURABILITY.SESSION) return 'session';
  return persistentFrameKind(doc);
}

/**
 * Build a data frame from an ap-store onChange() event (or an equivalent
 * shape). When `ts` is given, the frame carries a `cursor` in the same
 * (ts,id) encoding getChildrenSince()/replayResume() use — a live client
 * needs this to keep its "since" watermark current without waiting for an
 * explicit resume, so a later reconnect only replays what it actually
 * missed.
 */
export function buildDataFrame({ id, doc, collections = [], durability, sessionId, ts }) {
  const kind = frameKindForChange({ doc, durability });
  const frame = { kind, id, doc, collections, durability };
  if (sessionId !== undefined) frame.sessionId = sessionId;
  if (ts !== undefined) frame.cursor = encodeCursor({ ts, id });
  return frame;
}

/** Build a control frame. */
export function buildControlFrame(op, fields = {}) {
  if (!Object.values(CONTROL_OP).includes(op)) {
    throw new Error(`buildControlFrame: unknown op '${op}'`);
  }
  return { kind: 'control', op, ...fields };
}

export function isDataFrame(frame) {
  return !!frame && DATA_KINDS.has(frame.kind);
}

export function isControlFrame(frame) {
  return !!frame && frame.kind === 'control';
}

/** Parse and minimally validate a frame received off the wire. Throws on malformed input. */
export function parseFrame(raw) {
  const frame = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!frame || !FRAME_KINDS.includes(frame.kind)) {
    throw new Error('parseFrame: not a valid qu:StreamFrame');
  }
  if (isControlFrame(frame) && typeof frame.op !== 'string') {
    throw new Error('parseFrame: control frame missing op');
  }
  return frame;
}

export function serializeFrame(frame) {
  return JSON.stringify(frame);
}
