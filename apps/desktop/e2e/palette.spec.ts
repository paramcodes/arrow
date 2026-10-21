import { expect, test, type Page } from "@playwright/test";

/**
 * The command palette, the quick-open and the settings dialog.
 *
 * The suite drives the shell the way a reader does: it presses the shortcut,
 * types the letters they remember, runs the command the palette offers and
 * opens a file from the list of the workspace. The settings cases read the
 * editor after a change, because a setting that only moves a value in a store
 * is a setting the reader cannot see.
 *
 * The browser build has no Tauri host, so the file list and the settings come
 * through the fixture boundary and the store of the browser. That is the same
 * code the window runs; only the boundary behind it differs.
 */

const APP = "/workspace/src/app.ts";
const UTIL = "/workspace/src/util.ts";

/** The palette dialog. */
function palette(page: Page) {
  return page.getByTestId("command-palette");
}

/** The text field of the palette. */
function paletteInput(page: Page) {
  return page.getByTestId("command-input");
}

/** The size of the text of the active editor, as the browser paints it. */
async function fontSize(page: Page): Promise<string> {
  return page
    .locator('[data-testid="editor-area"] [data-active="true"] .cm-editor')
    .evaluate((node) => getComputedStyle(node).fontSize);
}

/** The editor that the reader sees. */
function activePane(page: Page) {
  return page.locator('[data-testid="editor-area"] [data-active="true"]');
}

test("the command palette opens on the shortcut and searches with fuzzy letters", async ({
  page,
}) => {
  await page.goto("/");

  await page.keyboard.press("Control+Shift+P");
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();

  // The letters of "toggle sidebar" in the order a reader remembers them, with
  // no run of them next to each other: a substring filter would find nothing.
  await paletteInput(page).fill("tsb");
  await expect(page.getByTestId("command-item-view.toggleSidebar")).toBeVisible();
  await expect(page.getByTestId("command-item-file.save")).toHaveCount(0);

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/command-palette.png` });
  }
});

test("a command of the palette runs and closes the palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("sidebar")).toBeVisible();

  await page.keyboard.press("Control+Shift+P");
  await paletteInput(page).fill("toggle sidebar");
  await page.getByTestId("command-item-view.toggleSidebar").click();

  await expect(palette(page)).toBeHidden();
  await expect
    .poll(async () => (await page.getByTestId("sidebar-panel").boundingBox())?.width ?? -1)
    .toBe(0);
});

test("the quick-open lists the files of the workspace and opens one", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Control+P");
  await expect(palette(page)).toBeVisible();

  // "utl" is a fuzzy spelling of "util.ts", not a substring of it.
  await paletteInput(page).fill("utl");
  await expect(page.getByTestId("quick-open-item-src/util.ts")).toBeVisible();
  await page.getByTestId("quick-open-item-src/util.ts").click();

  await expect(page.getByTestId(`tab-${UTIL}`)).toBeVisible();
  await expect(page.getByTestId(`pane-host-${UTIL}`).locator(".cm-content")).toContainText("Hello");
  await expect(page.getByTestId("status-language")).toHaveText("TypeScript");
});

test("the palette offers every shortcut of the shell as a command", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByTestId("command-item-view.toggleSidebar")).toBeVisible();
  await expect(page.getByTestId("command-item-terminal.toggle")).toBeVisible();
  await expect(page.getByTestId("command-item-settings.open")).toBeVisible();
  await expect(page.getByTestId("command-item-file.save")).toBeVisible();
  await expect(page.getByTestId("command-item-file.saveAll")).toBeVisible();
  await expect(page.getByTestId("command-item-file.quickOpen")).toBeVisible();
  await expect(page.getByTestId("command-item-palette.commands")).toBeVisible();
});

test("Cmd+, opens the settings, and the size and the wrapping apply live", async ({ page }) => {
  await page.goto("/");

  // A document has to be open before the size of its text can be read.
  await page.keyboard.press("Control+P");
  await paletteInput(page).fill("app");
  await page.getByTestId("quick-open-item-src/app.ts").click();
  await expect(page.getByTestId(`tab-${APP}`)).toBeVisible();

  const before = await fontSize(page);

  await page.keyboard.press("Control+,");
  await expect(page.getByTestId("settings-dialog")).toBeVisible();
  await expect(page.getByTestId("settings-font-size")).toHaveValue("14");

  await page.getByTestId("settings-font-size").fill("20");
  await expect(page.getByTestId("settings-font-size")).toHaveValue("20");
  await expect.poll(() => fontSize(page)).toBe("20px");
  expect(before).not.toBe("20px");

  await expect(activePane(page).locator(".cm-lineWrapping")).toHaveCount(0);
  await page.getByTestId("settings-word-wrap").check();
  await expect(activePane(page).locator(".cm-lineWrapping")).not.toHaveCount(0);

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/settings-dialog.png` });
  }
});

test("the settings survive a restart of the window", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Control+,");
  await page.getByTestId("settings-font-size").fill("21");
  await page.getByTestId("settings-word-wrap").check();
  await page.getByTestId("settings-tab-size").fill("4");
  await page.getByTestId("settings-done").click();
  await expect(page.getByTestId("settings-dialog")).toBeHidden();

  // A reload is the browser build's restart: the store of the browser holds
  // the document the window wrote, exactly as the plugin store does on disk.
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await page.keyboard.press("Control+,");
  await expect(page.getByTestId("settings-font-size")).toHaveValue("21");
  await expect(page.getByTestId("settings-tab-size")).toHaveValue("4");
  await expect(page.getByTestId("settings-word-wrap")).toBeChecked();
  await expect(page.getByTestId("status-tab-size")).toHaveText("Spaces: 4");
});

test("the status bar names the language of the active file", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status-language")).toHaveText("Plain Text");

  await page.keyboard.press("Control+P");
  await paletteInput(page).fill("main");
  await page.getByTestId("quick-open-item-src/main.rs").click();

  await expect(page.getByTestId("status-language")).toHaveText("Rust");
});
