import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The directory the layout components live in. */
const layoutDirectory = fileURLToPath(new URL(".", import.meta.url));

/**
 * The density of the shell.
 *
 * ADR-0003 records the decision: an editor is dense, its content sits eight
 * pixels from the edge of its panel and its borders are hairline. The shell
 * drifted to twelve pixels, which reads as a consumer app and not as an
 * editor.
 *
 * The guardrail reads the components of the shell and refuses a twelve pixel
 * padding. The padding of an empty state is not content padding, so the rule
 * holds the content of a panel and leaves the rest of the layout alone.
 */
describe("the density of the shell", () => {
  it("keeps the content padding at eight pixels", () => {
    const components = readdirSync(layoutDirectory).filter((name) => name.endsWith(".tsx"));

    expect(components.length).toBeGreaterThan(0);

    for (const name of components) {
      const source = readFileSync(`${layoutDirectory}${name}`, "utf8");

      expect(source, `${name} uses a twelve pixel padding`).not.toMatch(/\b(?:p|px|py)-3\b/);
    }
  });
});
