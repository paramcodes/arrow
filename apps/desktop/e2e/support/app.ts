import type { Page } from "@playwright/test";

/**
 * The helper that opens the app for the end to end suite.
 *
 * The shell of Arrow attaches the key handler of the command registry in an
 * effect, so a shortcut that a case sends at the load event can arrive before
 * the listener exists. The keypress is then lost, and a longer timeout cannot
 * bring it back, so the case waits for the window to say that it is ready.
 *
 * Every spec opens a page through this helper. A case that navigates on its
 * own waits for nothing, and the guardrail in
 * `apps/desktop/src/e2e-readiness.test.ts` fails when one of them does.
 */

/** The attribute the document element carries while the window is ready. */
export const READY_ATTRIBUTE = "data-arrow-ready";

/** The selector that finds the document element of a ready window. */
const READY = `html[${READY_ATTRIBUTE}="true"]`;

/** Waits until the page has attached its key handler. */
async function waitForReady(page: Page): Promise<void> {
  await page.waitForSelector(READY, { state: "attached" });
}

/**
 * Opens the app and waits until it is ready to be driven.
 *
 * The path is the page to open, and it defaults to the app itself. The editor
 * fixture is a page of its own, and it carries the same readiness signal.
 */
export async function openApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await waitForReady(page);
}

/**
 * Reloads the page and waits until it is ready to be driven again.
 *
 * A reload is the restart of the window in the browser build. The new document
 * attaches its key handler in an effect of its own, so the case waits for the
 * window to say that it is ready.
 */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await waitForReady(page);
}
