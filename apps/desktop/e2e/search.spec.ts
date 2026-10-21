import { expect, test, type Page } from "@playwright/test";

import { openApp } from "./support/app";

/**
 * The search of the workspace.
 *
 * The suite opens the search panel, searches a phrase of the fixture
 * workspace and clicks the match. The case then reads the editor: the file of
 * the match is the active tab and the caret sits on the line of the match, so
 * "a result opens the file at the matching line" is proved and not asserted.
 */

const APP = "/workspace/src/app.ts";

/** The field of the search panel. */
function searchInput(page: Page) {
  return page.getByTestId("search-input");
}

/** The editor that the reader sees. */
function activePane(page: Page) {
  return page.locator('[data-testid="editor-area"] [data-active="true"]');
}

test("the search panel finds a phrase across the files of the workspace", async ({ page }) => {
  await openApp(page);

  await page.getByTestId("activity-search").click();
  await expect(page.getByTestId("search-panel")).toBeVisible();

  await searchInput(page).fill("greet");
  await expect(page.getByTestId("search-result-0")).toBeVisible();
  await expect(page.getByTestId("search-summary")).toContainText("matches");

  // The phrase sits in two files of the fixture workspace, so the result list
  // names more than the file that happens to be first.
  const paths = await page
    .locator('[data-testid^="search-result-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-path")));
  expect(new Set(paths)).toEqual(new Set(["src/app.ts", "src/util.ts"]));

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/search-panel.png` });
  }
});

test("a search result opens its file at the matching line", async ({ page }) => {
  await openApp(page);

  await page.getByTestId("activity-search").click();
  await searchInput(page).fill("return greet");

  const match = page.locator('[data-testid^="search-result-"]').first();
  await expect(match).toHaveAttribute("data-path", "src/app.ts");
  await expect(match).toHaveAttribute("data-line", "4");

  await match.click();

  await expect(page.getByTestId(`tab-${APP}`)).toBeVisible();
  await expect(activePane(page).locator(".cm-content")).toContainText("return greet(name);");

  // The line of the match is the line the caret sits on, so the reader lands
  // on the word instead of at the top of the file.
  await expect(activePane(page).locator(".cm-lineNumbers .cm-activeLineGutter")).toHaveText("4");
});

test("a query that matches nothing says so", async ({ page }) => {
  await openApp(page);

  await page.getByTestId("activity-search").click();
  await searchInput(page).fill("this phrase is not in the fixture workspace");

  await expect(page.getByTestId("search-summary")).toHaveText("No match.");
  await expect(page.getByTestId("search-results")).toHaveCount(0);
});
