import { expect, test, type Page } from "@playwright/test";

import type { AiDebug } from "../src/lib/ai";
import { openApp } from "./support/app";

/**
 * The ghost text of the editor, driven in a plain browser.
 *
 * The browser build has no Tauri host, so the boundary answers from the stub
 * of `apps/desktop/src/lib/ai.ts` and the stream of tokens arrives the way it
 * arrives in the shell. The suite reads the screen the way a reader reads it:
 * the suggestion that fades after the caret, the document that takes it with
 * Tab, the key that throws it away and the state the status bar shows.
 */

declare global {
  interface Window {
    /** The texts the suggestion took while it streamed. */
    __arrowGhostTexts?: string[];
    /** The moment the reader typed the last time. */
    __arrowLastInput?: number;
    /** The states the status bar of the AI feature took. */
    __arrowAiStates?: string[];
    /** The handle of the AI boundary, for the end to end suite. */
    __arrowAi?: AiDebug;
  }
}

const ROOT = "/workspace";
const APP = `${ROOT}/src/app.ts`;

/** The text the stub of the boundary streams. */
const STREAM = "Arrow streams tokens in the browser.";

/** Open a directory of the tree. */
async function expand(page: Page, path: string): Promise<void> {
  await page.getByTestId(`tree-item-${path}`).click();
}

/** Open a file of the tree in a tab. */
async function open(page: Page, path: string): Promise<void> {
  await page.getByTestId(`tree-item-${path}`).click();
  await expect(page.getByTestId(`tab-${path}`)).toBeVisible();
}

/** The editor of the file the reader sees. */
function activeContent(page: Page) {
  return page.locator('[data-testid="editor-area"] [data-active="true"] .cm-content');
}

/**
 * The text of the document, without the suggestion that fades after the caret.
 *
 * The suggestion lives inside the document of the editor, so a reader of the
 * text of the page would read the suggestion with it. The clone drops the
 * suggestion and keeps the document.
 */
async function documentText(page: Page): Promise<string> {
  return activeContent(page).evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    for (const ghost of clone.querySelectorAll(".cm-ghost-text")) ghost.remove();
    return clone.textContent ?? "";
  });
}

/** Put the caret at the end of the document and type a line. */
async function typeAtTheEnd(page: Page, text: string): Promise<void> {
  const content = activeContent(page);
  await content.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("the ghost text appears after the reader stops typing", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await page.evaluate(() => {
    window.__arrowLastInput = performance.now();
    document.addEventListener(
      "input",
      () => {
        window.__arrowLastInput = performance.now();
      },
      true,
    );
  });

  await typeAtTheEnd(page, "const tail = 1;");

  const ghost = page.locator(".cm-ghost-text");
  await expect(ghost).toBeVisible({ timeout: 15_000 });
  await expect(ghost).toHaveText(STREAM);

  const waited = await page.evaluate(() => performance.now() - (window.__arrowLastInput ?? 0));
  expect(waited, "the engine waits for the reader to stop typing").toBeGreaterThanOrEqual(250);

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/ghost-text.png`, fullPage: true });
  }
});

test("the ghost text streams in token by token", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await page.evaluate(() => {
    const seen: string[] = [];
    window.__arrowGhostTexts = seen;

    const observer = new MutationObserver(() => {
      const node = document.querySelector(".cm-ghost-text");
      const text = node?.textContent ?? "";
      if (seen[seen.length - 1] !== text) seen.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  await typeAtTheEnd(page, "const tail = 1;");

  await expect(page.locator(".cm-ghost-text")).toHaveText(STREAM, { timeout: 15_000 });

  const texts = await page.evaluate(() => window.__arrowGhostTexts ?? []);
  expect(texts.length, "the suggestion grows while the stream runs").toBeGreaterThan(1);
  expect(texts[texts.length - 1]).toBe(STREAM);
  expect((texts[0] ?? "").length).toBeLessThan(STREAM.length);
});

test("Tab takes the ghost text into the document", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await typeAtTheEnd(page, "const tail = 1;");

  await expect(page.locator(".cm-ghost-text")).toHaveText(STREAM, { timeout: 15_000 });

  await page.keyboard.press("Tab");

  await expect(page.locator(".cm-ghost-text")).toHaveCount(0);
  await expect.poll(() => documentText(page), { timeout: 15_000 }).toContain(STREAM);
});

test("Escape throws the ghost text away and ends the request", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  // The stub streams fast by default, so a request is often over before the
  // case reaches the screen. A longer stream keeps the request open while the
  // reader throws the suggestion away. The case asks for it without a guard:
  // a stub that lost the knob fails the case instead of racing it.
  await page.evaluate(() => {
    const boundary = window.__arrowAi;
    if (!boundary) throw new Error("the AI boundary is not in the page");
    boundary.setTokenDelay(250);
  });

  await typeAtTheEnd(page, "const tail = 1;");

  await expect(page.locator(".cm-ghost-text")).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("Escape");

  await expect(page.locator(".cm-ghost-text")).toHaveCount(0);

  const cancelled = await page.evaluate(() =>
    (window.__arrowAi?.calls ?? []).filter((call) => call.command === "cancel_request"),
  );
  expect(
    cancelled.length,
    "the escape ends the request through the one cancel path",
  ).toBeGreaterThan(0);
});

test("moving the caret takes the ghost text away", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await typeAtTheEnd(page, "const tail = 1;");

  await expect(page.locator(".cm-ghost-text")).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("ArrowLeft");

  await expect(page.locator(".cm-ghost-text")).toHaveCount(0);
});

test("the status bar shows the state of the AI feature", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  const status = page.getByTestId("status-ai");
  await expect(status).toHaveAttribute("data-state", "no-key");

  await page.evaluate(() => {
    const seen: string[] = [];
    window.__arrowAiStates = seen;

    const observer = new MutationObserver(() => {
      const node = document.querySelector('[data-testid="status-ai"]');
      const state = node?.getAttribute("data-state") ?? "";
      if (seen[seen.length - 1] !== state) seen.push(state);
    });
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state"],
    });
  });

  await typeAtTheEnd(page, "const tail = 1;");

  await expect(page.locator(".cm-ghost-text")).toBeVisible({ timeout: 15_000 });

  const states = await page.evaluate(() => window.__arrowAiStates ?? []);
  expect(states, "the bar shows that the feature is working").toContain("loading");
});
