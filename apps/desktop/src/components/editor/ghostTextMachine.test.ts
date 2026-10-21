import { createActor } from "xstate";
import { describe, expect, it } from "vitest";

import { aiConnectionState, ghostTextMachine } from "./ghostTextMachine";

/**
 * The lifecycle of the ghost text.
 *
 * The machine is pure, so the cases drive it directly: they send the events
 * the driver sends and they read the state the driver reads. A machine that
 * lost a transition fails here instead of failing in the window of the
 * product.
 */

/** An actor of the machine, started. */
function startedMachine() {
  const actor = createActor(ghostTextMachine).start();
  return actor;
}

describe("the lifecycle of the ghost text", () => {
  it("waits for a suggestion when the reader typed", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });

    expect(actor.getSnapshot().value).toBe("waiting");
  });

  it("starts a request when the reader stopped typing", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });

    expect(actor.getSnapshot().value).toBe("streaming");
    expect(actor.getSnapshot().context.requestId).toBe("request-1");
  });

  it("ignores a trigger while a suggestion is on the screen", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "trigger", requestId: "request-2" });

    expect(actor.getSnapshot().value).toBe("streaming");
    expect(actor.getSnapshot().context.requestId).toBe("request-1");
  });

  it("grows the suggestion with the tokens that arrive", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "token", token: " const" });
    actor.send({ type: "token", token: " b = 2;" });

    expect(actor.getSnapshot().context.text).toBe(" const b = 2;");
  });

  it("keeps the suggestion when the stream ends", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "token", token: " const" });
    actor.send({ type: "complete" });

    expect(actor.getSnapshot().value).toBe("ready");
    expect(actor.getSnapshot().context.text).toBe(" const");
    expect(actor.getSnapshot().context.requestId).toBeNull();
  });

  it("forgets the suggestion when the request fails", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "token", token: " const" });
    actor.send({ type: "fail" });

    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.text).toBe("");
  });

  it("ends the request when the reader throws the suggestion away", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "dismiss" });

    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.requestId).toBeNull();
  });

  it("ends the request when the reader takes the suggestion", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "complete" });
    actor.send({ type: "accept" });

    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.text).toBe("");
  });

  it("ends the request when the reader takes the suggestion while the stream runs", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "token", token: " const" });
    actor.send({ type: "accept" });

    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.requestId).toBeNull();
  });

  it("waits again when the reader types while the stream runs", () => {
    const actor = startedMachine();

    actor.send({ type: "type" });
    actor.send({ type: "trigger", requestId: "request-1" });
    actor.send({ type: "type" });

    expect(actor.getSnapshot().value).toBe("waiting");
  });

  it("shows the state of the feature in the status bar", () => {
    expect(aiConnectionState("waiting", true)).toBe("loading");
    expect(aiConnectionState("streaming", true)).toBe("loading");
    expect(aiConnectionState("ready", true)).toBe("ready");
    expect(aiConnectionState("idle", true)).toBe("ready");
    expect(aiConnectionState("idle", false)).toBe("no-key");
    expect(aiConnectionState("ready", false)).toBe("no-key");
  });
});
