/**
 * The wire format of the terminal stream.
 *
 * The Rust half sends base64 bytes with a sequence number. The frontend
 * decodes the bytes, writes them to the terminal and keeps the sequence
 * number so a lost chunk is visible instead of silent.
 */

/**
 * Decodes a base64 chunk into bytes, or returns null when the chunk is not
 * base64 at all.
 *
 * The bytes are raw terminal output, so they are written to the terminal as
 * bytes and never as a UTF-8 string: an escape sequence or half of a
 * multi-byte character must survive the trip.
 */
export function decodeBase64(chunk: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(chunk);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The place of the chunk in the stream. */
export interface SequenceTracker {
  /** The sequence number of the last chunk that arrived. */
  last: number;
  /** The number of chunks that never arrived. */
  gaps: number;
}

/** A fresh tracker. */
export function createSequenceTracker(): SequenceTracker {
  return { last: 0, gaps: 0 };
}

/** What one chunk did to the stream. */
export interface SequenceStep {
  /** The chunks lost before this one, or zero when the stream is whole. */
  readonly lost: number;
  /** True when the chunk arrived after its place, such as a replay. */
  readonly duplicate: boolean;
}

/**
 * Records one sequence number and reports what the stream did.
 *
 * The first chunk of a session is sequence 1. A chunk that arrives with a
 * higher number means the chunks between them never arrived, and that is a
 * gap a reader has to see. A chunk at or below the last number is a replay or
 * a reordering, so it is not a gap and it does not move the stream.
 */
export function observeSequence(tracker: SequenceTracker, seq: number): SequenceStep {
  if (seq <= tracker.last) {
    return { lost: 0, duplicate: true };
  }

  const lost = seq - tracker.last - 1;
  tracker.last = seq;
  tracker.gaps += lost;

  return { lost, duplicate: false };
}
