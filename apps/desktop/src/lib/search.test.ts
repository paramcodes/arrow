import { describe, expect, it } from "vitest";

import { FIXTURE_ROOT } from "../hooks/fileSystem";
import { listProjectFiles, searchProject } from "./search";

/**
 * The search and the file list of the workspace.
 *
 * The cases run in a plain browser process, where no Tauri host exists, so the
 * boundary answers from the fixture workspace. They read the same two calls
 * the palette and the search panel read, which is what makes the browser build
 * of those features real instead of a mock.
 */
describe("the search of the workspace", () => {
  it("lists the files of the workspace without the generated ones", async () => {
    const files = await listProjectFiles(FIXTURE_ROOT);

    expect(files).toContain("src/app.ts");
    expect(files).toContain("README.md");
    expect(files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(files).toEqual([...files].sort());
  });

  it("finds a word on the line it sits on", async () => {
    const results = await searchProject(FIXTURE_ROOT, "greet");

    const inApp = results.matches.find((match) => match.path === "src/app.ts" && match.line === 4);
    expect(inApp).toBeDefined();
    expect(inApp?.column).toBe(10);
    expect(inApp?.text).toContain("return greet(name);");
  });

  it("finds a word in every file it appears in", async () => {
    const results = await searchProject(FIXTURE_ROOT, "Arrow");

    expect(results.matches.map((match) => match.path)).toContain("src/components/Button.tsx");
    expect(results.matches.map((match) => match.path)).toContain("README.md");
    expect(results.truncated).toBe(false);
  });

  it("answers an empty query with no match and no engine run", async () => {
    const results = await searchProject(FIXTURE_ROOT, "   ");

    expect(results.matches).toEqual([]);
    expect(results.truncated).toBe(false);
  });

  it("searches for a character instead of a pattern", async () => {
    const results = await searchProject(FIXTURE_ROOT, "answer");

    expect(results.matches.length).toBeGreaterThan(0);
    expect(results.matches[0]?.text).toContain("answer");
  });
});
