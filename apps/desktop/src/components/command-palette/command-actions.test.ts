import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The actions of the command registry.
 *
 * The registry is a table of actions, and the test of the registry is a
 * table of spies. A new action that the table of the test does not know
 * leaves the test of that action without a spy, and the test of the registry
 * stays green: the type of the table is checked by the compiler, and the
 * compiler of the app leaves the test files out.
 *
 * The guardrail reads the interface of the actions and the table of the test
 * and fails when the table misses one of them.
 */

/** The directory the palette components live in. */
const paletteDirectory = fileURLToPath(new URL(".", import.meta.url));

/** The names of the actions the registry can run. */
function actionNames(): readonly string[] {
  const source = readFileSync(`${paletteDirectory}commands.ts`, "utf8");
  const start = source.indexOf("export interface CommandActions");
  const block = source.slice(start, source.indexOf("}", start));

  return [...block.matchAll(/readonly (\w+):/g)].map((match) => match[1] ?? "");
}

describe("the actions of the command registry", () => {
  it("gives every action a spy in the table of the test", () => {
    const names = actionNames();
    const table = readFileSync(`${paletteDirectory}commands.test.ts`, "utf8");

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(table, `the table of actions of the registry misses ${name}`).toContain(
        `${name}: vi.fn()`,
      );
    }
  });
});
