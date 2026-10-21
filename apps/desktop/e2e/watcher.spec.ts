import { expect, test, type Page } from "@playwright/test";

/**
 * The watcher and the git layer of the frontend.
 *
 * The suite drives the shell the way a reader does: it opens a project, it
 * watches the tree follow a change of the disk, it reads the badges of the
 * repository on the rows of the tree and it reads the branch and the counts
 * in the status bar.
 *
 * The browser build has no Rust host, so the boundary answers from the
 * fixture of `apps/desktop/src/lib/tauri.ts`. The suite never reads that
 * fixture directly: it emits the changes the Rust watcher emits and reads the
 * screen, the way a reader does.
 */

const ROOT = "/workspace";
const APP = `${ROOT}/src/app.ts`;
const UTIL = `${ROOT}/src/util.ts`;
const README = `${ROOT}/README.md`;

declare global {
  interface Window {
    /** The stub of the watcher and git boundary, for the end to end suite. */
    __arrowShellStub?: {
      readonly calls: readonly { command: string; args: Record<string, unknown> }[];
      emit: (kind: "changed" | "created" | "deleted", path: string) => void;
    };
  }
}

/** Open a directory of the tree. */
async function expand(page: Page, path: string): Promise<void> {
  await page.getByTestId(`tree-item-${path}`).click();
}

/** Emit a change of the disk, the way the watcher of the shell reports it. */
async function emit(
  page: Page,
  kind: "changed" | "created" | "deleted",
  path: string,
): Promise<void> {
  await page.evaluate(
    ([eventKind, eventPath]) => {
      window.__arrowShellStub?.emit(eventKind as "changed" | "created" | "deleted", eventPath);
    },
    [kind, path] as const,
  );
}

/** The commands the frontend asked the shell to run. */
function calls(page: Page) {
  return page.evaluate(() => window.__arrowShellStub?.calls ?? []);
}

test("the tree follows a change of the disk", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("file-tree")).toBeVisible();
  await expand(page, `${ROOT}/src`);

  const appeared = `${ROOT}/src/watched.ts`;
  await emit(page, "created", appeared);
  await expect(page.getByTestId(`tree-item-${appeared}`)).toBeVisible();

  await emit(page, "deleted", UTIL);
  await expect(page.getByTestId(`tree-item-${UTIL}`)).toHaveCount(0);

  // The file that is gone is gone for good: a change of the disk does not
  // bring it back.
  await emit(page, "changed", UTIL);
  await expect(page.getByTestId(`tree-item-${UTIL}`)).toHaveCount(0);
});

test("a change of the disk reads the state of the repository again", async ({ page }) => {
  await page.goto("/");
  await expand(page, `${ROOT}/src`);

  const before = (await calls(page)).filter((call) => call.command === "git_status").length;

  await emit(page, "changed", APP);

  await expect
    .poll(async () => (await calls(page)).filter((call) => call.command === "git_status").length)
    .toBeGreaterThan(before);
});

test("the tree shows the badge of the state of every file", async ({ page }) => {
  await page.goto("/");
  await expand(page, `${ROOT}/src`);

  const modified = page.getByTestId(`tree-badge-${APP}`);
  await expect(modified).toBeVisible();
  await expect(modified).toHaveText("M");

  const untracked = page.getByTestId(`tree-badge-${UTIL}`);
  await expect(untracked).toBeVisible();
  await expect(untracked).toHaveText("U");

  const deleted = page.getByTestId(`tree-badge-${README}`);
  await expect(deleted).toBeVisible();
  await expect(deleted).toHaveText("D");

  const decoration = await deleted.evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(decoration).toContain("line-through");
});

test("the status bar shows the branch and the counts of the repository", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("status-branch")).toHaveText("main");
  await expect(page.getByTestId("status-modified")).toHaveText("1M");
  await expect(page.getByTestId("status-untracked")).toHaveText("1U");
  await expect(page.getByTestId("status-diff")).toContainText("↑");
});

test("a project opens through the folder picker", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("open-folder").click();

  await expect(page.getByTestId("status-branch")).toHaveText("main");
  await expect(page.getByTestId(`tree-item-${README}`)).toBeVisible();

  const watched = (await calls(page)).filter((call) => call.command === "watch_directory");
  expect(watched.length).toBeGreaterThan(0);
  expect(watched[watched.length - 1]?.args.path).toBe(ROOT);
});

test("the command palette opens a folder and reads the repository again", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.getByTestId("command-input").fill("open folder");
  await page.getByTestId("command-item-file.openFolder").click();

  await expect(page.getByTestId("status-branch")).toHaveText("main");
});
