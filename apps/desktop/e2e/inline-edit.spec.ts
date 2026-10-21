import { expect, test, type Page } from "@playwright/test";

import type { AiDebug } from "../src/lib/ai";
import { openApp } from "./support/app";

/**
 * The inline edit of the editor, driven in a plain browser.
 *
 * The browser build has no Tauri host, so the boundary answers from the stub
 * of `apps/desktop/src/lib/ai.ts`: the proposal of the model arrives the way
 * it arrives in the shell, one token at a time. The suite reads the screen the
 * way a reader reads it: the prompt above the selection, the diff in the
 * document, the two answers of the reader and the settings of the feature.
 */

declare global {
  interface Window {
    /** The handle of the AI boundary, for the end to end suite. */
    __arrowAi?: AiDebug;
  }
}

const ROOT = "/workspace";
const APP = `${ROOT}/src/app.ts`;

/** The line of the fixture file the cases edit. */
const FUNCTION_LINE = "export function main(name: string): string {";

/** The mark the stub adds to the line the reader selected. */
const MARKER = "the model rewrote this line";

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
 * The text of the document, without the lines the model proposes.
 *
 * The proposal is painted by a widget inside the document of the editor, so a
 * reader of the text of the page would read the proposal with it. The clone
 * drops the widget and keeps the document.
 */
async function documentText(page: Page): Promise<string> {
  return activeContent(page).evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    for (const added of clone.querySelectorAll(".cm-inline-diff-added")) added.remove();
    return clone.textContent ?? "";
  });
}

/** Put the caret on the line of the function of the fixture file. */
async function caretOnTheFunctionLine(page: Page): Promise<void> {
  await activeContent(page).click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
}

/** Ask the model for a change of the line under the caret. */
async function askForAChange(page: Page): Promise<void> {
  await caretOnTheFunctionLine(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("inline-edit-bar")).toBeVisible();
  await page.getByTestId("inline-edit-input").fill("add a comment to the line");
  await page.getByTestId("inline-edit-input").press("Enter");
}

test("Cmd+K opens the prompt bar above the selection", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await caretOnTheFunctionLine(page);
  await page.keyboard.press("Control+k");

  const bar = page.getByTestId("inline-edit-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-status", "prompting");
  await expect(page.getByTestId("inline-edit-input")).toBeFocused();

  const barBox = await bar.boundingBox();
  const lineBox = await activeContent(page).locator(".cm-line").nth(2).boundingBox();
  expect(barBox, "the bar sits on the screen").not.toBeNull();
  expect(lineBox, "the line of the reader sits on the screen").not.toBeNull();
  expect(
    (barBox?.y ?? 0) + (barBox?.height ?? 0),
    "the bar sits above the line the reader selected",
  ).toBeLessThanOrEqual((lineBox?.y ?? 0) + 2);
});

test("the instruction streams the response as an inline diff", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await askForAChange(page);

  await expect(page.locator(".cm-inline-diff-removed")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cm-inline-diff-added")).toBeVisible({ timeout: 15_000 });

  const text = await documentText(page);
  expect(text, "the code of the reader is still in the document").toContain(FUNCTION_LINE);
  expect(text, "the proposal is not in the document yet").not.toContain(MARKER);

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/inline-diff.png`, fullPage: true });
  }
});

test("Cmd+Enter applies the diff", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await askForAChange(page);

  await expect(page.getByTestId("inline-edit-accept")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Control+Enter");

  await expect.poll(() => documentText(page), { timeout: 15_000 }).toContain(MARKER);
  await expect(page.locator(".cm-inline-diff-removed")).toHaveCount(0);
  await expect(page.getByTestId("inline-edit-bar")).toHaveCount(0);
});

test("Escape throws the diff away and leaves the code as it was", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await askForAChange(page);

  await expect(page.locator(".cm-inline-diff-added")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");

  await expect(page.locator(".cm-inline-diff-removed")).toHaveCount(0);
  await expect(page.locator(".cm-inline-diff-added")).toHaveCount(0);

  const text = await documentText(page);
  expect(text, "the proposal never reached the document").not.toContain(MARKER);
  expect(text, "the code of the reader is still in the document").toContain(FUNCTION_LINE);
});

test("the status bar routes a reader without a key to the AI settings", async ({ page }) => {
  await openApp(page);

  const status = page.getByTestId("status-ai");
  await expect(status).toHaveAttribute("data-state", "no-key");
  await expect(status).toContainText("click to configure");

  await page.getByTestId("status-ai-configure").click();

  await expect(page.getByTestId("settings-dialog")).toBeVisible();
  await expect(page.getByTestId("settings-ai")).toBeVisible();

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/ai-settings.png`, fullPage: true });
  }
});

test("the model selector offers the models of the provider", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("status-ai-configure").click();
  await expect(page.getByTestId("settings-dialog")).toBeVisible();

  const model = page.getByTestId("ai-model");
  await expect(model).toHaveValue("claude-sonnet-4-5");

  await page.getByTestId("ai-provider-openai").click();
  await expect(model).toHaveValue("gpt-4o");
  await expect(model).toContainText("GPT-4o");

  await page.getByTestId("ai-provider-google").click();
  await expect(model).toHaveValue("gemini-2.0-flash");
  await expect(model).toContainText("Gemini 2.5 Pro");
});

test("the key of the provider reaches the store of the window", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("status-ai-configure").click();
  await expect(page.getByTestId("settings-dialog")).toBeVisible();

  await page.getByTestId("ai-api-key").fill("the-key-a-reader-typed");
  await page.getByTestId("ai-api-key-save").click();

  await expect(page.getByTestId("ai-key-status")).toContainText("A key is in the keychain");
  await expect(page.getByTestId("status-ai")).toHaveAttribute("data-state", "ready");

  const asked = await page.evaluate(() => window.__arrowAi?.calls ?? []);
  const stored = asked.filter((call) => call.command === "set_api_key");
  expect(stored.length, "the shell was asked to keep the key").toBeGreaterThan(0);
  expect(JSON.stringify(stored), "the key never reaches the log of the calls").not.toContain(
    "the-key-a-reader-typed",
  );
});

test("the reader who moves the caret loses the proposal and the bar closes", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  await askForAChange(page);

  await expect(page.locator(".cm-inline-diff-removed")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("ArrowDown");

  await expect(
    page.locator(".cm-inline-diff-removed"),
    "the edit belongs to the text it applies to",
  ).toHaveCount(0);
  await expect(
    page.getByTestId("inline-edit-bar"),
    "the bar closes with the proposal, so no dead answer is left on the screen",
  ).toHaveCount(0);
});
