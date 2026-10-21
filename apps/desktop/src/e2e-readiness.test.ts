import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The directory the end to end specs live in. */
const e2eDirectory = fileURLToPath(new URL("../e2e/", import.meta.url));

/**
 * Every spec of the suite, at any depth of the end to end folder.
 */
function specFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) files.push(...specFiles(path));
    else if (entry.name.endsWith(".spec.ts")) files.push(path);
  }

  return files;
}

/**
 * The readiness of the app.
 *
 * The shell of Arrow attaches the key handler of the command registry in an
 * effect, so a shortcut that a case sends at the load event can arrive before
 * the listener exists. The keypress is lost then, and a longer timeout cannot
 * bring it back. Every case therefore opens its page through the helper of
 * `apps/desktop/e2e/support/app.ts`, which waits for the window to say that
 * it is ready.
 *
 * The guardrail reads the specs of the suite and refuses a spec that navigates
 * on its own. Such a spec waits for nothing, so the race returns the first
 * time the machine is busy.
 */
describe("the readiness of the app", () => {
  it("opens every page of the suite through the helper that waits for it", () => {
    const specs = specFiles(e2eDirectory);

    expect(specs.length).toBeGreaterThan(0);

    for (const spec of specs) {
      const source = readFileSync(spec, "utf8");
      const name = spec.slice(e2eDirectory.length);

      expect(
        source,
        `${name} navigates on its own, it must open the page through the helper of apps/desktop/e2e/support/app.ts`,
      ).not.toMatch(/\bpage\.(?:goto|reload)\s*\(/);
    }
  });
});
