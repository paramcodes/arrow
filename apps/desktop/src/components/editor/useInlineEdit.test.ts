import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorView } from "@arrow/editor-core";

import { createInlineEditActor } from "../../machines/inline-edit";
import { submitInstruction } from "./useInlineEdit";

/**
 * The submit of the inline edit.
 *
 * The hook is a thin adapter over the machine and the boundary, so the case
 * drives the submit the way the bar of the prompt calls it: a real machine
 * and a real request driver, with the shell of `../../lib/ai` behind a mock.
 * The case holds the one rule the hook has to obey and nothing else.
 */

/** The shell calls the case counts, one counter per call. */
const shell = vi.hoisted(() => ({
  startInlineEdit: vi.fn(),
  cancelRequest: vi.fn(),
}));

vi.mock("../../lib/ai", () => ({
  startInlineEdit: shell.startInlineEdit,
  cancelRequest: shell.cancelRequest,
  onAiToken: async () => async () => {},
  onAiComplete: async () => async () => {},
  onAiError: async () => async () => {},
}));

const view = {} as EditorView;

/** A document on the screen, and the empty runtime beside it. */
function screen() {
  return {
    viewRef: { current: view },
    runtime: {
      current: { requestId: null, from: 0, to: 0, original: "", unlisten: null },
    },
    facts: {
      current: { active: true, provider: "anthropic" as const, model: "claude-sonnet-4-5" },
    },
    endRequest: vi.fn(),
  };
}

describe("the submit of the inline edit", () => {
  beforeEach(() => {
    shell.startInlineEdit.mockReset();
    shell.cancelRequest.mockReset();
  });

  it("starts the request the reader sent while the machine asks for one", async () => {
    const actor = createInlineEditActor();
    actor.send({ type: "CMD_K", from: 8, to: 20, original: "const a = 1;" });

    submitInstruction({
      actor,
      ...screen(),
      instruction: "make it shorter",
    });

    await vi.waitFor(() => {
      expect(shell.startInlineEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          instruction: "make it shorter",
          selection: "const a = 1;",
          requestId: expect.stringContaining("inline-edit-"),
        }),
      );
    });
    expect(actor.getSnapshot().value).toBe("streaming");
    expect(shell.cancelRequest).not.toHaveBeenCalled();
  });

  it("does nothing while the machine is idle", async () => {
    const actor = createInlineEditActor();
    const desk = screen();
    const endRequest = desk.endRequest;

    submitInstruction({ actor, ...desk, instruction: "make it shorter" });
    await Promise.resolve();

    expect(endRequest).not.toHaveBeenCalled();
    expect(
      shell.startInlineEdit,
      "no request leaves a workflow that owns none",
    ).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("does nothing while the tokens stream", async () => {
    const actor = createInlineEditActor();
    actor.send({ type: "CMD_K", from: 8, to: 20, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-edit-1" });

    submitInstruction({ actor, ...screen(), instruction: "make it shorter still" });
    await Promise.resolve();

    expect(
      shell.startInlineEdit,
      "the request in flight is the one that runs",
    ).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).toBe("streaming");
    expect(actor.getSnapshot().context.instruction).toBe("make it shorter");
    expect(actor.getSnapshot().context.requestId).toBe("inline-edit-1");
  });

  it("does nothing while the edit waits for the reader", async () => {
    const actor = createInlineEditActor();
    actor.send({ type: "CMD_K", from: 8, to: 20, original: "const a = 1;" });
    actor.send({ type: "SUBMIT", instruction: "make it shorter", requestId: "inline-edit-1" });
    actor.send({ type: "COMPLETE" });

    submitInstruction({ actor, ...screen(), instruction: "make it shorter still" });
    await Promise.resolve();

    expect(shell.startInlineEdit).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).toBe("reviewing");
  });
});
