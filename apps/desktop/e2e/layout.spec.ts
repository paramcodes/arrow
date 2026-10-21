import { expect, test, type Page } from "@playwright/test";

/**
 * The resize of the shell.
 *
 * A handle that a pointer cannot grab is a handle that does not exist, so the
 * test reads the box of the handle before it drags it. The panels move on a
 * spring, so every size is read with a poll that waits for the movement to
 * settle.
 */

/** The box of an element, or null when the element has no box. */
async function box(page: Page, testId: string) {
  const element = page.getByTestId(testId);
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error(`${testId} has no box`);
  return bounds;
}

/** The width of the sidebar, read until it settles on the wanted size. */
async function sidebarWidth(page: Page) {
  return page.getByTestId("sidebar-panel").evaluate((node) => node.getBoundingClientRect().width);
}

test("the handles have a box to grab", async ({ page }) => {
  await page.goto("/");

  const handle = await box(page, "sidebar-handle");
  expect(handle.width).toBeGreaterThan(0);

  await page.getByTestId("activity-terminal").click();

  const bottom = await box(page, "bottom-panel-handle");
  expect(bottom.height).toBeGreaterThan(0);
});

test("dragging the sidebar handle resizes the sidebar", async ({ page }) => {
  await page.goto("/");

  const before = await sidebarWidth(page);
  const handle = await box(page, "sidebar-handle");

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  await expect.poll(() => sidebarWidth(page)).toBeGreaterThan(before);
});

test("dragging the bottom handle resizes the bottom panel", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("activity-terminal").click();

  const panel = page.getByTestId("bottom-panel-panel");
  const before = await panel.evaluate((node) => node.getBoundingClientRect().height);
  const handle = await box(page, "bottom-panel-handle");

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 80, {
    steps: 12,
  });
  await page.mouse.up();

  await expect
    .poll(() => panel.evaluate((node) => node.getBoundingClientRect().height))
    .toBeGreaterThan(before);
});

test("the arrow keys resize the panels", async ({ page }) => {
  await page.goto("/");

  const handle = page.getByTestId("sidebar-handle");
  await handle.focus();

  const value = async () => Number(await handle.getAttribute("aria-valuenow"));
  const before = await value();
  expect(before).toBe(240);

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => value()).toBe(before + 16);
  await expect.poll(() => sidebarWidth(page)).toBeGreaterThan(before);

  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => value()).toBe(before);

  await page.getByTestId("activity-terminal").click();
  const bottom = page.getByTestId("bottom-panel-handle");
  await bottom.focus();
  const panel = page.getByTestId("bottom-panel-panel");

  await expect.poll(async () => Number(await bottom.getAttribute("aria-valuenow"))).toBe(220);
  await expect
    .poll(() => panel.evaluate((node) => node.getBoundingClientRect().height))
    .toBeGreaterThan(0);

  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => Number(await bottom.getAttribute("aria-valuenow"))).toBe(236);
  await expect
    .poll(() => panel.evaluate((node) => node.getBoundingClientRect().height))
    .toBeGreaterThan(220);
});
