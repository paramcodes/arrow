import { expect, test, type Page } from "@playwright/test";

/**
 * The integrated terminal.
 *
 * The browser build has no Tauri host, so the boundary answers from the stub
 * in `apps/desktop/src/lib/tauri.ts`: a fake session id, a canned transcript
 * and the same events Rust sends. The suite drives the panel the way a reader
 * does and reads the terminal through the debug handle the component hands
 * out, because xterm.js paints its text into a canvas and the DOM carries no
 * copy of it.
 */

/** What the terminal reports to the suite. */
interface TerminalDebug {
  readonly tabId: string;
  readonly sessionId: string | null;
  readonly status: string;
  readonly renderer: string;
  readonly cols: number;
  readonly rows: number;
  readonly gaps: number;
  readonly lastSeq: number;
  readonly variables: Readonly<Record<string, string>>;
  readonly buffer: () => string;
}

/** The stub of the boundary, as the suite drives it. */
interface PtyStubDebug {
  readonly calls: ReadonlyArray<{
    readonly command: string;
    readonly args: Record<string, unknown>;
  }>;
  emitData: (id: string, seq: number, text: string) => void;
  emitExit: (id: string, code: number) => void;
}

declare global {
  interface Window {
    __arrowTerminal?: TerminalDebug;
    __arrowPtyStub?: PtyStubDebug;
  }
}

/** Opens the bottom panel and waits for the first terminal session. */
async function openTerminal(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("activity-terminal").click();
  await expect(page.getByTestId("terminal-manager")).toBeVisible();

  await expect
    .poll(async () => page.evaluate(() => window.__arrowTerminal?.sessionId ?? null))
    .not.toBeNull();
}

/** The text the terminal currently displays. */
function buffer(page: Page): Promise<string> {
  return page.evaluate(() => window.__arrowTerminal?.buffer() ?? "");
}

/** The channels of a CSS color, read through a canvas. */
function channels(page: Page, value: string): Promise<number[]> {
  return page.evaluate((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return [];

    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, value);
}

/** The channels of a token of the shipped palette. */
function tokenChannels(page: Page, variable: string): Promise<number[]> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return [];

    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, variable);
}

test("the terminal renders in the bottom panel with the Arrow theme", async ({ page }) => {
  await openTerminal(page);

  const screen = page.locator('[data-testid^="terminal-screen-"][data-active="true"]');
  await expect(screen).toBeVisible();

  const report = await page.evaluate(() => window.__arrowTerminal ?? null);
  expect(report).not.toBeNull();

  // The ANSI slots read the tokens of the palette, slot by slot.
  expect(await channels(page, report?.variables["--terminal-ansi-red"] ?? "")).toEqual(
    await tokenChannels(page, "--error"),
  );
  expect(await channels(page, report?.variables["--terminal-ansi-green"] ?? "")).toEqual(
    await tokenChannels(page, "--success"),
  );
  expect(await channels(page, report?.variables["--terminal-ansi-blue"] ?? "")).toEqual(
    await tokenChannels(page, "--info"),
  );
  expect(await channels(page, report?.variables["--canvas-soft"] ?? "")).toEqual(
    await tokenChannels(page, "--canvas-soft"),
  );
  expect(await channels(page, report?.variables["--ink"] ?? "")).toEqual(
    await tokenChannels(page, "--ink"),
  );

  // The WebGL renderer is the one the panel paints with.
  expect(report?.renderer).toBe("webgl");
});

test("the stub transcript arrives as bytes and is written to the terminal", async ({ page }) => {
  await openTerminal(page);

  await expect.poll(() => buffer(page)).toContain("Arrow terminal (browser stub)");
  await expect.poll(() => buffer(page)).toContain("hello");

  // A key press reaches the PTY as a write, the way typing does.
  await page.keyboard.type("ls");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          window.__arrowPtyStub?.calls.some(
            (call) => call.command === "write_pty" && call.args.data === "l",
          ) ?? false,
      ),
    )
    .toBe(true);
});

test("a sequence gap is detected and named in the terminal", async ({ page }) => {
  await openTerminal(page);
  await expect.poll(() => buffer(page)).toContain("hello");

  const sessionId = await page.evaluate(() => window.__arrowTerminal?.sessionId ?? null);
  expect(sessionId).not.toBeNull();

  await page.evaluate((id) => {
    window.__arrowPtyStub?.emitData(id, 40, "after the gap\r\n");
  }, sessionId ?? "");

  await expect
    .poll(async () => page.evaluate(() => window.__arrowTerminal?.gaps ?? 0))
    .toBeGreaterThan(0);
  await expect.poll(() => buffer(page)).toContain("terminal stream gap");
  await expect.poll(() => buffer(page)).toContain("after the gap");
});

test("dragging the panel fits the terminal and resizes the PTY", async ({ page }) => {
  await openTerminal(page);

  const before = await page.evaluate(() => ({
    cols: window.__arrowTerminal?.cols ?? 0,
    rows: window.__arrowTerminal?.rows ?? 0,
    id: window.__arrowTerminal?.sessionId ?? "",
  }));
  expect(before.rows).toBeGreaterThan(0);

  const handle = page.getByTestId("bottom-panel-handle");
  const box = await handle.boundingBox();
  if (!box) throw new Error("the bottom panel has no handle to drag");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => page.evaluate(() => window.__arrowTerminal?.rows ?? 0))
    .toBeGreaterThan(before.rows);

  await expect
    .poll(async () =>
      page.evaluate(
        (id) =>
          window.__arrowPtyStub?.calls.some(
            (call) => call.command === "resize_pty" && call.args.id === id,
          ) ?? false,
        before.id,
      ),
    )
    .toBe(true);

  const after = await page.evaluate(() => ({
    cols: window.__arrowTerminal?.cols ?? 0,
    rows: window.__arrowTerminal?.rows ?? 0,
  }));
  const lastResize = await page.evaluate(
    (id) =>
      [...(window.__arrowPtyStub?.calls ?? [])]
        .reverse()
        .find((call) => call.command === "resize_pty" && call.args.id === id)?.args ?? null,
    before.id,
  );

  expect(lastResize?.cols).toBe(after.cols);
  expect(lastResize?.rows).toBe(after.rows);
});

test("terminal tabs open, switch and close their PTY", async ({ page }) => {
  await openTerminal(page);

  const firstTab = await page.evaluate(() => window.__arrowTerminal?.tabId ?? "");
  const firstSession = await page.evaluate(() => window.__arrowTerminal?.sessionId ?? "");
  expect(firstTab).not.toBe("");

  await page.getByTestId("terminal-new").click();
  await expect(page.getByTestId("terminal-manager").getByRole("tab")).toHaveCount(2);

  const secondTab = await page.evaluate(() => window.__arrowTerminal?.tabId ?? "");
  const secondSession = await page.evaluate(() => window.__arrowTerminal?.sessionId ?? "");
  expect(secondTab).not.toBe(firstTab);
  expect(secondSession).not.toBe(firstSession);

  // The first tab keeps its session while the second one is on screen.
  await page.getByTestId(`terminal-select-${firstTab}`).click();
  await expect
    .poll(async () => page.evaluate(() => window.__arrowTerminal?.sessionId ?? ""))
    .toBe(firstSession);

  await page.getByTestId(`terminal-close-${firstTab}`).click();
  await expect(page.getByTestId("terminal-manager").getByRole("tab")).toHaveCount(1);

  await expect
    .poll(async () =>
      page.evaluate(
        (id) =>
          window.__arrowPtyStub?.calls.some(
            (call) => call.command === "kill_pty" && call.args.id === id,
          ) ?? false,
        firstSession,
      ),
    )
    .toBe(true);

  // The tab that is left is the one that was already open.
  await expect
    .poll(async () => page.evaluate(() => window.__arrowTerminal?.sessionId ?? ""))
    .toBe(secondSession);
});

test("Ctrl+Shift+backquote opens a new terminal wherever the focus is", async ({ page }) => {
  await openTerminal(page);
  await expect(page.getByTestId("terminal-manager").getByRole("tab")).toHaveCount(1);

  await page.keyboard.press("Control+Shift+Backquote");

  await expect(page.getByTestId("terminal-manager").getByRole("tab")).toHaveCount(2);
});
