import { expect, test } from "@playwright/test";

/**
 * The smoke test proves the frontend boots in a plain browser, with no Tauri
 * host present.
 */
test("the app boots to a blank Arrow window", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Arrow");
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arrow" })).toBeVisible();

  const evidence = process.env.ARROW_EVIDENCE_DIR;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/arrow-window.png`, fullPage: true });
  }
});
