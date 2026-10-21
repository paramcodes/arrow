import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * The root of this repository.
 *
 * The config lives in the root of the repository, so the root is the directory
 * the config file sits in. It is the path of the worktree when the repository
 * is a worktree, and the path of the checkout when it is not.
 */
const root = dirname(fileURLToPath(import.meta.url));

/**
 * The port of the browser server.
 *
 * This program runs several sessions at the same time on one machine, and each
 * session has its own worktree with its own copy of the code. A fixed port
 * would let one worktree attach to the server of another one and drive the
 * wrong build, so the port is derived from the path of the repository. Two
 * worktrees never share a port, and no coordination between them is needed.
 *
 * The port sits in the unregistered range, so it cannot collide with a service
 * of the machine, and the same path always gets the same port, so a run of one
 * worktree always finds its own server where it left it.
 */
export const port = 4300 + (createHash("sha256").update(root).digest().readUInt32BE(0) % 500);

const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./apps/desktop/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter @arrow/desktop exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    // The server of this tree, or no server at all. A server that already
    // holds the port belongs to another tree, and a suite that drives it tests
    // another build, so the run fails loudly instead of testing the wrong code.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
