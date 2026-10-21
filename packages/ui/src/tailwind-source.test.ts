import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The root of the repository. */
const repository = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The source discovery of Tailwind.
 *
 * The primitives of this package ship utility classes of their own. Tailwind
 * collects the utilities from the files it scans, and the default scan reaches
 * only the directory of the CSS entry point, which is the app and not this
 * package. A package that the scan does not reach renders unstyled: the
 * resize handle loses its width, the tooltip loses its surface, and nothing
 * says why.
 *
 * The list of the scanned files lives in one file, and the guardrail reads it.
 */
describe("the Tailwind source discovery", () => {
  it("scans every package that ships utility classes", () => {
    const config = readFileSync(`${repository}apps/desktop/tailwind.config.js`, "utf8");
    const packages = readdirSync(`${repository}packages`).filter((name) =>
      existsSync(`${repository}packages/${name}/src`),
    );

    expect(packages.length).toBeGreaterThan(0);

    for (const name of packages) {
      const scanned = config.includes("packages/*/src") || config.includes(`packages/${name}/src`);

      expect(scanned, `${name} is not scanned by Tailwind`).toBe(true);
    }
  });
});
