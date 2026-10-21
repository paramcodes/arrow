import { expect, test, type Page } from "@playwright/test";

/**
 * The editor of Arrow, driven in a plain browser.
 *
 * The suite reads the editor the way a reader of the product reads it: the
 * colors it paints with, the tokens it highlights, the gutter it numbers, the
 * brackets it matches, the text it edits and the search it runs.
 */

const FIXTURE = "/e2e/editor.fixture.html";

/** The languages the engine ships, one pane each. */
const LANGUAGES = ["typescript", "javascript", "python", "rust", "json", "markdown"] as const;

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

/** The text of a pane. */
async function paneText(page: Page, pane: string): Promise<string> {
  return (await page.locator(`[data-testid="${pane}"] .cm-content`).innerText()) ?? "";
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
  await page.goto(FIXTURE);

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
  await page.goto(FIXTURE);

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

test("the editor numbers the lines and shows the fold gutter", async ({ page }) => {
  await page.goto(FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await expect(pane.locator(".cm-lineNumbers")).toBeVisible();
  await expect(pane.locator(".cm-foldGutter")).toBeVisible();
  await expect(pane.locator(".cm-lineNumbers .cm-gutterElement:visible").first()).toHaveText("1");

  const gutter = pane.locator(".cm-gutters");
  const gutterColor = await gutter.evaluate((node) => getComputedStyle(node).color);
  expect(gutterColor).toBe(await tokenColor(page, "--ink-tertiary"));
});

test("the editor marks the active line", async ({ page }) => {
  await page.goto(FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await focusLine(page, "pane-typescript", 2);

  await expect(pane.locator(".cm-activeLine")).toHaveCount(1);
  await expect(pane.locator(".cm-lineNumbers .cm-activeLineGutter")).toHaveCount(1);
});

test("the editor matches the brackets", async ({ page }) => {
  await page.goto(FIXTURE);

  const pane = page.locator('[data-testid="pane-typescript"]');
  await focusLine(page, "pane-typescript", 3);

  await expect(pane.locator(".cm-matchingBracket")).toHaveCount(2);
});

test("the editor edits, undoes and redoes", async ({ page }) => {
  await page.goto(FIXTURE);

  const pane = "pane-typescript";
  await page.locator(`[data-testid="${pane}"] .cm-content`).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("const tail = 1;");

  await expect.poll(() => paneText(page, pane)).toContain("const tail = 1;");

  await page.keyboard.press("Control+z");
  await expect.poll(() => paneText(page, pane)).not.toContain("const tail = 1;");

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => paneText(page, pane)).toContain("const tail = 1;");
});

test("the editor searches the document", async ({ page }) => {
  await page.goto(FIXTURE);

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
