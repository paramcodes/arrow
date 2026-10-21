import { describe, expect, it } from "vitest";

import { createSequenceTracker, decodeBase64, observeSequence } from "./protocol";

/**
 * The wire format of the terminal stream.
 *
 * The bytes are raw terminal output, so the cases read bytes back and never
 * a string: a chunk that splits a character or carries an escape sequence has
 * to survive the trip whole.
 */
describe("the terminal stream", () => {
  it("decodes base64 into the bytes it carries", () => {
    const bytes = decodeBase64("aGVsbG8=");

    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe("hello");
  });

  it("keeps a multi-byte character whole", () => {
    const original = new TextEncoder().encode("arrow → terminal");
    const encoded = btoa(String.fromCharCode(...original));
    const decoded = decodeBase64(encoded);

    expect(decoded).not.toBeNull();
    expect(new TextDecoder().decode(decoded ?? new Uint8Array())).toBe("arrow → terminal");
  });

  it("refuses a chunk that is not base64", () => {
    expect(decodeBase64("not base64 at all !")).toBeNull();
  });

  it("reads the first chunk of a session as the first place in the stream", () => {
    const tracker = createSequenceTracker();

    expect(observeSequence(tracker, 1)).toEqual({ lost: 0, duplicate: false });
    expect(tracker.last).toBe(1);
    expect(tracker.gaps).toBe(0);
  });

  it("detects a gap when the sequence skips a number", () => {
    const tracker = createSequenceTracker();

    observeSequence(tracker, 1);
    const step = observeSequence(tracker, 3);

    expect(step.lost).toBe(1);
    expect(tracker.last).toBe(3);
    expect(tracker.gaps).toBe(1);
  });

  it("counts every chunk of a long gap", () => {
    const tracker = createSequenceTracker();

    observeSequence(tracker, 2);
    const step = observeSequence(tracker, 9);

    expect(step.lost).toBe(6);
    expect(tracker.gaps).toBe(7);
  });

  it("does not report a replayed chunk as a gap", () => {
    const tracker = createSequenceTracker();

    observeSequence(tracker, 4);
    const step = observeSequence(tracker, 2);

    expect(step).toEqual({ lost: 0, duplicate: true });
    expect(tracker.last).toBe(4);
    expect(tracker.gaps).toBe(3);
  });
});
