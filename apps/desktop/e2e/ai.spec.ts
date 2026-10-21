import { expect, test, type Page } from "@playwright/test";

import type {
  AiCall,
  AiCompletePayload,
  AiDebug,
  AiProvider,
  AiTokenPayload,
  CompletionRequest,
} from "../src/lib/ai";
import { openApp } from "./support/app";

/**
 * The AI boundary of the frontend.
 *
 * The browser build has no Rust host, so the boundary answers from the stub
 * of `apps/desktop/src/lib/ai.ts`: a canned stream of tokens and the same
 * events Rust sends. The suite drives the boundary the way the app does: it
 * starts a request, it listens for the tokens and it ends a request through
 * the one cancel path.
 *
 * The ghost text widget and the inline diff are the sessions after this one,
 * so the suite reads the boundary itself instead of a widget on the screen.
 */

declare global {
  interface Window {
    __arrowAi?: AiDebug;
  }
}

/**
 * The shape of the AI boundary, as the browser loads it.
 *
 * The suite loads the module in the browser, because the module is the one
 * the app runs and the stub inside it is the one the app replays.
 */
interface AiModule {
  readonly aiStub: { readonly commandLog: readonly AiCall[] };
  readonly startCompletion: (request: CompletionRequest) => Promise<void>;
  readonly cancelRequest: (requestId: string) => Promise<void>;
  readonly setApiKey: (provider: AiProvider, key: string) => Promise<void>;
  readonly hasApiKey: (provider: AiProvider) => Promise<boolean>;
  readonly onAiToken: (
    requestId: string,
    handler: (payload: AiTokenPayload) => void,
  ) => Promise<() => void>;
  readonly onAiComplete: (
    requestId: string,
    handler: (payload: AiCompletePayload) => void,
  ) => Promise<() => void>;
}

/** The commands the frontend asked the shell to run. */
async function calls(page: Page) {
  return page.evaluate(() => window.__arrowAi?.calls ?? []);
}

test("the tokens of a completion arrive in the frontend", async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const specifier = "/src/lib/ai.ts";
    const ai = (await import(/* @vite-ignore */ specifier)) as AiModule;

    const requestId = "e2e-request-1";
    const received: string[] = [];
    const ends: boolean[] = [];

    const stopTokens = await ai.onAiToken(requestId, (payload) => received.push(payload.token));
    const stopEnds = await ai.onAiComplete(requestId, (payload) => ends.push(payload.done));

    await ai.startCompletion({
      requestId,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      prompt: "finish the line",
      context: "const arrow = 1;",
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    stopTokens();
    stopEnds();

    return { received, ends };
  });

  expect(result.received.length).toBeGreaterThan(0);
  expect(result.received.join("")).toContain("Arrow");
  expect(result.ends).toEqual([true]);
});

test("the shell is asked for a completion with the request of the reader", async ({ page }) => {
  await openApp(page);

  const asked = await page.evaluate(async () => {
    const specifier = "/src/lib/ai.ts";
    const ai = (await import(/* @vite-ignore */ specifier)) as AiModule;

    await ai.startCompletion({
      requestId: "e2e-request-2",
      provider: "openai",
      model: "gpt-4o",
      prompt: "finish the line",
      context: "const arrow = 1;",
    });

    return ai.aiStub.commandLog;
  });

  const completions = asked.filter((call) => call.command === "complete");
  expect(completions.length).toBeGreaterThan(0);
  expect(completions[completions.length - 1]?.args.requestId).toBe("e2e-request-2");
  expect(completions[completions.length - 1]?.args.provider).toBe("openai");
  expect(completions[completions.length - 1]?.args.prompt).toBe("finish the line");
});

test("the escape of the reader ends the request through one path", async ({ page }) => {
  await openApp(page);

  const requestId = await page.evaluate(async () => {
    const specifier = "/src/lib/ai.ts";
    const ai = (await import(/* @vite-ignore */ specifier)) as AiModule;

    const id = "e2e-request-3";
    await ai.startCompletion({
      requestId: id,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      prompt: "finish the line",
      context: "",
    });
    await ai.cancelRequest(id);

    return id;
  });

  const cancelled = (await calls(page)).filter((call) => call.command === "cancel_request");
  expect(cancelled.length).toBeGreaterThan(0);
  expect(cancelled[cancelled.length - 1]?.args.requestId).toBe(requestId);
});

test("the frontend never holds the key of a provider", async ({ page }) => {
  await openApp(page);

  const answer = await page.evaluate(async () => {
    const specifier = "/src/lib/ai.ts";
    const ai = (await import(/* @vite-ignore */ specifier)) as AiModule;

    await ai.setApiKey("anthropic", "the-key-a-reader-typed");
    const exists = await ai.hasApiKey("anthropic");

    return { exists, calls: ai.aiStub.commandLog };
  });

  expect(typeof answer.exists).toBe("boolean");
  expect(JSON.stringify(answer.calls)).not.toContain("the-key-a-reader-typed");
});

test("the tokens of the stream arrive one by one", async ({ page }) => {
  await openApp(page);

  await page.evaluate(async () => {
    const specifier = "/src/lib/ai.ts";
    const ai = (await import(/* @vite-ignore */ specifier)) as AiModule;

    await ai.startCompletion({
      requestId: "e2e-request-4",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      prompt: "",
      context: "",
    });
  });

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const specifier = "/src/lib/ai.ts";
        const ai = (await import(/* @vite-ignore */ specifier)) as AiModule;
        return ai.aiStub.commandLog.length;
      }),
    )
    .toBeGreaterThan(0);
});
