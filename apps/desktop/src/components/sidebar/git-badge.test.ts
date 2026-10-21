import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The badges of the tree.
 *
 * The shell owns git, and the shell reads the state of the repository once
 * for the whole project. The tree turns that state into a map of badges and
 * hands the map to its rows, so a row reads its badge out of a map and never
 * asks the shell for the state of its own file.
 *
 * The guardrail reads the sources of the sidebar and refuses a file that asks
 * the shell for the state of the repository. A row that fetched the status
 * would ask the shell once per row, and a tree of a thousand rows would ask
 * it a thousand times.
 */

/** The directory the sidebar components live in. */
const sidebarDirectory = fileURLToPath(new URL(".", import.meta.url));

/** The commands of the boundary that read the state of a repository. */
const GIT_COMMANDS = ["gitStatus(", "gitBranch(", "gitDiffStat("];

/** The sources of the sidebar, without the tests themselves. */
function sources(): { readonly name: string; readonly source: string }[] {
  return readdirSync(sidebarDirectory)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) => !name.includes(".test."))
    .map((name) => ({ name, source: readFileSync(`${sidebarDirectory}${name}`, "utf8") }));
}

describe("the badges of the tree", () => {
  it("never asks the shell for the state of the repository", () => {
    const files = sources();

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      for (const command of GIT_COMMANDS) {
        expect(
          file.source,
          `${file.name} reads the state of the repository with ${command}`,
        ).not.toContain(command);
      }
    }
  });

  it("builds the badges of the whole status at once", () => {
    const tree = readFileSync(`${sidebarDirectory}FileTree.tsx`, "utf8");

    expect(tree).toContain("gitBadges(");
  });
});
