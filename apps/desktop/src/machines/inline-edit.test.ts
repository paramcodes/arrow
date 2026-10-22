import { describe, expect, it } from "vitest";

import { createInlineEditActor, type InlineEditActor } from "./inline-edit";

/**
 * The lifecycle of the inline edit.
 *
 * The machine is pure, so every case drives it without a browser: the cases
 * send the events the shell sends and read the state the reader sees. A case
 * that reads the code instead of the behaviour would pass when the machine
 * stopped working.
 */

/** A machine that is ready to answer. */
function machine(): InlineEditActor {
  return createInlineEditActor();
}

/** The state the machine is in. */
function statusOf(actor: InlineEditActor): string {
  return actor.getSnapshot().value as string;
}

describe("the machine of the inline edit", () => {
  it("opens the prompt when the reader asks for it", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });

    expect(statusOf(actor)).toBe("prompting");
    expect(actor.getSnapshot().context.original).toBe("const a = 1;");
    expect(actor.getSnapshot().context.from).toBe(0);
    expect(actor.getSnapshot().context.to).toBe(12);
  });

  it("refuses the prompt when the reader has nothing to edit", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 0, original: "   " });

    expect(statusOf(actor), "a range of nothing holds nothing to edit").toBe("idle");
  });

  it("sends the request when the instruction says something", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });

    expect(statusOf(actor)).toBe("streaming");
    expect(actor.getSnapshot().context.requestId).toBe("inline-1");
    expect(actor.getSnapshot().context.instruction).toBe("make it shorter");
  });

  it("refuses the request when the instruction says nothing", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "   ", requestId: "inline-1" });

    expect(statusOf(actor), "an empty instruction asks for nothing").toBe("prompting");
    expect(actor.getSnapshot().context.requestId).toBeNull();
  });

  it("builds the proposal from the tokens", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });

    actor.send({ type: "TOKEN", token: "const " });
    actor.send({ type: "TOKEN", token: "a = 2;" });

    expect(actor.getSnapshot().context.proposed).toBe("const a = 2;");
  });

  it("waits for the reader when the stream ends", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });
    actor.send({ type: "COMPLETE" });

    expect(statusOf(actor)).toBe("reviewing");
  });

  it("goes back to idle when the reader takes the edit", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });
    actor.send({ type: "COMPLETE" });
    actor.send({ type: "ACCEPT" });

    expect(statusOf(actor)).toBe("idle");
    expect(actor.getSnapshot().context.proposed).toBe("");
  });

  it("goes back to idle when the reader throws the edit away", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });
    actor.send({ type: "COMPLETE" });
    actor.send({ type: "REJECT" });

    expect(statusOf(actor)).toBe("idle");
  });

  it("ends the request when the reader leaves", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });
    actor.send({ type: "CANCEL" });

    expect(statusOf(actor)).toBe("idle");
    expect(actor.getSnapshot().context.requestId).toBeNull();
  });

  it("keeps the message of a failure", () => {
    const actor = machine();

    actor.send({ type: "CMD_K", from: 0, to: 12, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-1" });
    actor.send({ type: "CANCEL", error: "there is no key for anthropic" });

    expect(actor.getSnapshot().context.error).toBe("there is no key for anthropic");
  });

  it("ignores the events of a workflow that is not running", () => {
    const actor = machine();

    actor.send({ type: "TOKEN", token: "const " });
    actor.send({ type: "COMPLETE" });
    actor.send({ type: "ACCEPT" });

    expect(statusOf(actor)).toBe("idle");
    expect(actor.getSnapshot().context.proposed).toBe("");
  });
});
