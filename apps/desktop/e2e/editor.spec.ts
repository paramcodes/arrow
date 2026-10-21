import { expect, test, type Page } from "@playwright/test";

import { openApp } from "./support/app";

/**
 * The editor of Arrow, driven in a plain browser.
 *
 * The suite reads the editor the way a reader of the product reads it: the
 * colors it paints with, the tokens it highlights, the gutter it numbers, the
 * brackets it matches, the text it edits and the search it runs.
 *
 * Every case names the behaviour it proves, and the behavior is what the
 * assertion reads. A case that reads the palette of every token proves that
 * the tokens are painted, not that the language is the one the caller asked
 * for, so the language case reads one named token of every language.
 */

declare global {
  interface Window {
    /** The caret of the pane that takes its text from the page. */
    __arrowCaret?: () => { anchor: number; head: number; length: number } | null;
  }
}

const FIXTURE = "/e2e/editor.fixture.html";

/** The languages the engine ships, one pane each. */
const LANGUAGES = ["typescript", "javascript", "python", "rust", "json", "markdown"] as const;

/**
 * A token that only the right parser paints in that color.
 *
 * The word is the token of the sample of the pane, and the color is the token
 * of the palette that the highlighter of the engine gives it. A registry that
 * hands a language the parser of another one paints the word in another
 * color, or not at all.
 */
const LANGUAGE_TOKENS = [
  { language: "typescript", word: "const", color: "--accent" },
  { language: "typescript", word: "string", color: "--info" },
  { language: "javascript", word: "const", color: "--accent" },
  { language: "javascript", word: '"arrow"', color: "--success" },
  { language: "python", word: "def", color: "--accent" },
  { language: "python", word: "42", color: "--info" },
  { language: "rust", word: "fn", color: "--accent" },
  { language: "rust", word: "i32", color: "--info" },
  { language: "rust", word: "println", color: "--warning" },
  { language: "json", word: '"answer"', color: "--ink-secondary" },
  { language: "json", word: "42", color: "--info" },
  { language: "markdown", word: "#", color: "--accent" },
] as const;

/** The color a token of the palette resolves to in the page. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

/** The colors of every styled token of a pane. */
async function tokenColors(page: Page, pane: string): Promise<string[]> {
  return page
    .locator(`[data-testid="${pane}"] .cm-content span`)
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
}

/** The color of one named token of a pane, or an empty string when it is missing. */
async function wordColor(page: Page, pane: string, word: string): Promise<string> {
  return page.locator(`[data-testid="${pane}"] .cm-content`).evaluate((node, wanted) => {
    const spans = Array.from(node.querySelectorAll("span"));
    const hit = spans.find((span) => span.textContent === wanted);
    return hit ? getComputedStyle(hit).color : "";
  }, word);
}

/** The text of a pane. */
async function paneText(page: Page, pane: string): Promise<string> {
  return (await page.locator(`[data-testid="${pane}"] .cm-content`).innerText()) ?? "";
}

/** The caret of the pane that takes its text from the page. */
async function caret(page: Page) {
  return page.evaluate(() => window.__arrowCaret?.() ?? null);
}

/** Put the cursor at the end of a line of a pane. */
async function focusLine(page: Page, pane: string, line: number): Promise<void> {
  await page.locator(`[data-testid="${pane}"] .cm-content`).click();
  await page.keyboard.press("Control+Home");
  for (let step = 1; step < line; step += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("End");
}

test("the editor renders with the dark theme of Arrow", async ({ page }) => {
  await openApp(page, FIXTURE);

  const editor = page.locator('[data-testid="pane-typescript"] .cm-editor');
  await expect(editor).toBeVisible();

  const background = await editor.evaluate((node) => getComputedStyle(node).backgroundColor);
  const canvas = await tokenColor(page, "--canvas");
  expect(background).toBe(canvas);

  const ink = await tokenColor(page, "--ink");
  const foreground = await editor.evaluate((node) => getComputedStyle(node).color);
  expect(foreground).toBe(ink);

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/editor-pane.png`, fullPage: true });
  }
});

test("every language of the registry is highlighted with the palette", async ({ page }) => {
  await openApp(page, FIXTURE);

  const palette = await Promise.all(
    [
      "--ink",
      "--ink-secondary",
      "--ink-tertiary",
      "--accent",
      "--success",
      "--warning",
      "--info",
    ].map((token) => tokenColor(page, token)),
  );
  const ink = await tokenColor(page, "--ink");

  for (const language of LANGUAGES) {
    const colors = await tokenColors(page, `pane-${language}`);

    expect(colors.length, `${language} has no highlighted token`).toBeGreaterThan(0);
    for (const color of colors) {
      expect(palette, `${language} paints a color outside the palette`).toContain(color);
    }
    expect(
      colors.some((color) => color !== ink),
      `${language} paints no token in a color of its own`,
    ).toBe(true);
  }
});

test("every language of the registry is highlighted by its own parser", async ({ page }) => {
  await openApp(page, FIXTURE);

  for (const { language, word, color } of LANGUAGE_TOKENS) {
    const painted = await wordColor(page, `pane-${language}`, word);

    expect(painted, `${language} does not paint the token ${word}`).not.toBe("");
    expect(painted, `${language} paints the token ${word} in another color than ${color}`).toBe(
      await tokenColor(page, color),
    );
  }
});

test("the editor numbers the lines and shows the fold gutter", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await expect(pane.locator(".cm-lineNumbers")).toBeVisible();
  await expect(pane.locator(".cm-foldGutter")).toBeVisible();
  await expect(pane.locator(".cm-lineNumbers .cm-gutterElement:visible").first()).toHaveText("1");

  const gutter = pane.locator(".cm-gutters");
  const gutterColor = await gutter.evaluate((node) => getComputedStyle(node).color);
  expect(gutterColor).toBe(await tokenColor(page, "--ink-tertiary"));
});

test("the editor marks the active line", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await focusLine(page, "pane-typescript", 2);

  await expect(pane.locator(".cm-activeLine")).toHaveCount(1);
  await expect(pane.locator(".cm-lineNumbers .cm-activeLineGutter")).toHaveCount(1);

  const line = await pane
    .locator(".cm-activeLine")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(line).toBe(await tokenColor(page, "--canvas-soft"));

  const gutter = await pane
    .locator(".cm-lineNumbers .cm-activeLineGutter")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(gutter).toBe(await tokenColor(page, "--canvas-soft"));
});

test("the editor matches the brackets", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await focusLine(page, "pane-typescript", 3);

  await expect(pane.locator(".cm-matchingBracket")).toHaveCount(2);
});

test("the editor edits, undoes and redoes", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = "pane-typescript";
  await page.locator(`[data-testid="${pane}"] .cm-content`).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("const tail = 1;");

  await expect.poll(() => paneText(page, pane), { timeout: 15_000 }).toContain("const tail = 1;");

  await page.keyboard.press("Control+z");
  await expect
    .poll(() => paneText(page, pane), { timeout: 15_000 })
    .not.toContain("const tail = 1;");

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => paneText(page, pane), { timeout: 15_000 }).toContain("const tail = 1;");
});

test("the editor searches the document", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await page.locator('[data-testid="pane-typescript"] .cm-content').click();
  await page.keyboard.press("Control+f");

  const search = pane.getByRole("textbox", { name: "Find" });
  await expect(search).toBeVisible();
  await search.pressSequentially("greet");

  await expect(pane.locator(".cm-searchMatch").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(pane.getByRole("textbox", { name: "Find" })).toHaveCount(0);
});

test("a change of the content prop keeps the caret", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = page.locator('[data-testid="pane-content"] .cm-content');
  await pane.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  const before = await caret(page);
  expect(before).not.toBeNull();

  await page.getByTestId("reload-content").click();

  await expect
    .poll(() => paneText(page, "pane-content"), { timeout: 15_000 })
    .toContain(": string");
  const after = await caret(page);
  expect(after?.anchor).toBe(before?.anchor);
  expect(after?.head).toBe(before?.head);
});

test("typing inside the editor keeps the caret where the typing put it", async ({ page }) => {
  await openApp(page, FIXTURE);

  const pane = page.locator('[data-testid="pane-content"] .cm-content');
  await pane.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("const tail = 1;");

  await expect
    .poll(() => paneText(page, "pane-content"), { timeout: 15_000 })
    .toContain("const tail = 1;");

  const after = await caret(page);
  expect(after?.head).toBe(after?.length);
});

test("a change of the extensions prop takes effect", async ({ page }) => {
  await openApp(page, FIXTURE);

  const content = page.locator('[data-testid="pane-tools"] .cm-content');
  await expect(content).not.toHaveAttribute("data-arrow-tool", "ghost");

  await page.getByTestId("mount-tool").click();

  await expect(content).toHaveAttribute("data-arrow-tool", "ghost");
});
