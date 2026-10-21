import { expect, test, type Page } from "@playwright/test";

import { openApp } from "./support/app";

declare global {
  interface Window {
    /** The caret of the active pane, for the end to end suite. */
    __arrowEditorCaret?: () => { anchor: number; head: number; path: string } | null;
  }
}

/**
 * The file system and the tabs of the shell.
 *
 * The suite drives the shell the way a reader does: it opens a directory,
 * opens files in tabs, edits one, saves it with the keyboard, closes a dirty
 * tab, switches between tabs and renames an entry of the tree.
 *
 * The browser build has no Tauri host, so the boundary answers from the
 * fixture workspace in `apps/desktop/src/hooks/fileSystem.ts`. The suite never
 * reads that fixture directly: it reads the tree, the tabs and the editor, the
 * way a reader does, and a save is proved by opening the file again.
 */

const ROOT = "/workspace";
const APP = `${ROOT}/src/app.ts`;
const UTIL = `${ROOT}/src/util.ts`;

/** Open a directory of the tree. */
async function expand(page: Page, path: string): Promise<void> {
  await page.getByTestId(`tree-item-${path}`).click();
}

/** Open a file of the tree in a tab. */
async function open(page: Page, path: string): Promise<void> {
  await page.getByTestId(`tree-item-${path}`).click();
  await expect(page.getByTestId(`tab-${path}`)).toBeVisible();
}

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

/** The content of the active pane. */
function activeContent(page: Page) {
  return page.locator('[data-testid="editor-area"] [data-active="true"] .cm-content');
}

/** The color of one word of the active editor. */
async function wordColor(page: Page, word: string): Promise<string> {
  return activeContent(page).evaluate((node, wanted) => {
    const spans = Array.from(node.querySelectorAll("span"));
    const hit = spans.find((span) => span.textContent === wanted);
    return hit ? getComputedStyle(hit).color : "";
  }, word);
}

/** The caret of the active pane. */
async function caret(page: Page) {
  return page.evaluate(() => window.__arrowEditorCaret?.() ?? null);
}

test("the tree reads the workspace and opens a file inside the shell", async ({ page }) => {
  await openApp(page);

  await expect(page.getByTestId("file-tree")).toBeVisible();
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  const area = page.getByTestId("editor-area");
  await expect(area.locator('[data-active="true"] .cm-editor')).toBeVisible();
  await expect(area.getByTestId("tab-bar")).toBeVisible();
  await expect(page.getByTestId("editor-pane")).toHaveAttribute("data-language", "typescript");

  await expect(page.getByTestId("breadcrumbs")).toContainText("src");
  await expect(page.getByTestId("breadcrumbs")).toContainText("app.ts");

  const accent = await tokenColor(page, "--accent");
  await expect.poll(() => wordColor(page, "import")).toBe(accent);

  await open(page, `${ROOT}/src/main.rs`);
  await expect(page.getByTestId("editor-pane").last()).toHaveAttribute("data-language", "rust");
});

test("a modified file shows a dirty indicator, and Cmd+S writes it to the disk", async ({
  page,
}) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);

  const content = activeContent(page);
  await content.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// written by the suite\n");

  const dirty = page.getByTestId(`tab-dirty-${APP}`);
  await expect(dirty).toBeVisible();

  await page.keyboard.press("Control+s");
  await expect(dirty).toHaveCount(0);

  await page.getByTestId(`tab-close-${APP}`).click();
  await expect(page.getByTestId(`tab-${APP}`)).toHaveCount(0);

  await open(page, APP);
  await expect(content).toContainText("// written by the suite");
});

test("closing a tab with unsaved changes asks first", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, UTIL);

  const content = activeContent(page);
  await content.click();
  await page.keyboard.type("// unsaved\n");
  await expect(page.getByTestId(`tab-dirty-${UTIL}`)).toBeVisible();

  await page.getByTestId(`tab-close-${UTIL}`).click();
  await expect(page.getByTestId("close-confirm")).toBeVisible();

  await page.getByTestId("close-confirm-cancel").click();
  await expect(page.getByTestId(`tab-${UTIL}`)).toBeVisible();

  await page.getByTestId(`tab-close-${UTIL}`).click();
  await page.getByTestId("close-confirm-discard").click();
  await expect(page.getByTestId(`tab-${UTIL}`)).toHaveCount(0);
});

test("switching tabs preserves the caret of each file", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);
  await open(page, UTIL);

  await page.getByTestId(`tab-${APP}`).click();
  const content = activeContent(page);
  await content.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  const before = await caret(page);
  expect(before).not.toBeNull();
  expect(before?.path).toBe(APP);

  await page.getByTestId(`tab-${UTIL}`).click();
  await expect(page.getByTestId(`pane-host-${UTIL}`)).toHaveAttribute("data-active", "true");

  await page.getByTestId(`tab-${APP}`).click();
  await expect(page.getByTestId(`pane-host-${APP}`)).toHaveAttribute("data-active", "true");

  const after = await caret(page);
  expect(after?.path).toBe(APP);
  expect(after?.anchor).toBe(before?.anchor);
  expect(after?.head).toBe(before?.head);
});

test("the context menu creates, renames and deletes an entry", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("file-tree")).toBeVisible();
  await expand(page, `${ROOT}/src`);

  await page.getByTestId(`tree-item-${ROOT}/src`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File" }).click();
  await page.getByTestId("tree-dialog-input").fill("note.ts");
  await page.getByTestId("tree-dialog-confirm").click();

  const created = `${ROOT}/src/note.ts`;
  await expect(page.getByTestId(`tree-item-${created}`)).toBeVisible();

  await page.getByTestId(`tree-item-${created}`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("tree-dialog-input").fill("renamed.ts");
  await page.getByTestId("tree-dialog-confirm").click();

  const renamed = `${ROOT}/src/renamed.ts`;
  await expect(page.getByTestId(`tree-item-${renamed}`)).toBeVisible();
  await expect(page.getByTestId(`tree-item-${created}`)).toHaveCount(0);

  await page.getByTestId(`tree-item-${renamed}`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByTestId("tree-dialog-confirm").click();

  await expect(page.getByTestId(`tree-item-${renamed}`)).toHaveCount(0);
});

test("deleting an open dirty file asks before it throws the work away", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, UTIL);

  const content = activeContent(page);
  await content.click();
  await page.keyboard.type("// unsaved\n");
  await expect(page.getByTestId(`tab-dirty-${UTIL}`)).toBeVisible();

  await page.getByTestId(`tree-item-${UTIL}`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByTestId("tree-dialog-confirm").click();

  await expect(page.getByTestId("close-confirm")).toBeVisible();
  await expect(page.getByTestId("close-confirm")).toContainText("util.ts has unsaved changes.");

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/filesystem-delete-confirm.png`, fullPage: true });
  }

  await page.getByTestId("close-confirm-cancel").click();
  await expect(page.getByTestId(`tree-item-${UTIL}`)).toBeVisible();
  await expect(page.getByTestId(`tab-${UTIL}`)).toBeVisible();
  await expect(page.getByTestId(`tab-dirty-${UTIL}`)).toBeVisible();

  await page.getByTestId(`tree-item-${UTIL}`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByTestId("tree-dialog-confirm").click();
  await page.getByTestId("close-confirm-discard").click();

  await expect(page.getByTestId(`tree-item-${UTIL}`)).toHaveCount(0);
  await expect(page.getByTestId(`tab-${UTIL}`)).toHaveCount(0);
});

test("the shell shows the tree, the tabs and the editor together", async ({ page }) => {
  await openApp(page);
  await expand(page, `${ROOT}/src`);
  await open(page, APP);
  await open(page, UTIL);
  await page.getByTestId(`tab-${APP}`).click();

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/filesystem-tabs.png`, fullPage: true });
  }
});
