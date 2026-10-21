import { describe, expect, it } from "vitest";

import {
  aiStub,
  cancelRequest,
  deleteApiKey,
  hasApiKey,
  onAiComplete,
  onAiError,
  onAiToken,
  setApiKey,
  startCompletion,
  startInlineEdit,
} from "./ai";

/**
 * The AI boundary of the frontend.
 *
 * The browser build has no Rust host, so the boundary answers from the stub
 * of `apps/desktop/src/lib/ai.ts`: a canned stream of tokens and the same
 * events Rust sends. The cases drive the boundary the way the app does.
 */

/** Wait until the boundary received `count` tokens of a request. */
async function waitForTokens(requestId: string, count: number): Promise<string[]> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (aiStub.tokens.length >= count) return [...aiStub.tokens];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return [...aiStub.tokens];
}

describe("the AI boundary", () => {
  it("replays the token stream of a completion", async () => {
    const requestId = "request-1";
    const tokens: string[] = [];
    const ends: boolean[] = [];

    const stopTokens = await onAiToken(requestId, (payload) => tokens.push(payload.token));
    const stopEnds = await onAiComplete(requestId, (payload) => ends.push(payload.done));

    await startCompletion({
      requestId,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      prompt: "finish the line",
      context: "const arrow = 1;",
    });

    await waitForTokens(requestId, 1);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tokens.join("")).toContain("Arrow");
    expect(ends).toEqual([true]);

    stopTokens();
    stopEnds();
  });

  it("names the request in every call it sends", async () => {
    await startInlineEdit({
      requestId: "request-2",
      provider: "openai",
      model: "gpt-4o",
      instruction: "make it shorter",
      selection: "a very long line",
    });

    const call = [...aiStub.commandLog].reverse().find((entry) => entry.command === "inline_edit");
    expect(call?.args.requestId).toBe("request-2");
    expect(call?.args.instruction).toBe("make it shorter");
  });

  it("ends a request through one command path", async () => {
    await startCompletion({
      requestId: "request-3",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      prompt: "",
      context: "",
    });

    await cancelRequest("request-3");

    const call = [...aiStub.commandLog]
      .reverse()
      .find((entry) => entry.command === "cancel_request");
    expect(call?.args.requestId).toBe("request-3");
  });

  it("answers whether a provider has a key, and never answers with one", async () => {
    const answer = await hasApiKey("anthropic");

    expect(typeof answer, "the bridge never returns the key").toBe("boolean");
    expect(answer).toBe(false);
  });

  it("keeps no key material in the log of the calls", async () => {
    await setApiKey("anthropic", "the-key-a-reader-typed");

    const log = JSON.stringify(aiStub.commandLog);
    expect(log, "the browser stub keeps no key material").not.toContain("the-key-a-reader-typed");
    expect(log).toContain("[redacted]");
  });

  it("removes the key of a provider", async () => {
    await deleteApiKey("openai");

    const call = [...aiStub.commandLog]
      .reverse()
      .find((entry) => entry.command === "delete_api_key");
    expect(call?.args.provider).toBe("openai");
  });

  it("listens for the failure of a request", async () => {
    const failures: string[] = [];
    const stop = await onAiError("request-4", (payload) => failures.push(payload.error));

    expect(failures).toEqual([]);
    stop();
  });
});
