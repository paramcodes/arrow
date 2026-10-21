import { describe, expect, it } from "vitest";

import { absoluteGitPath, badgeFor, gitBadges } from "./git";

/**
 * The git facts of a project.
 *
 * The shell owns git and the frontend reads what the shell answers. The
 * badge of a file is the letter a reader of a diff expects, and the badge of
 * a file the tree holds is looked up under the path of the tree, because git
 * names a file relative to the root of the repository.
 */
describe("the git facts", () => {
  it("gives every state a letter and a tone of the palette", () => {
    expect(badgeFor("modified")).toEqual({ letter: "M", tone: "warning", struck: false });
    expect(badgeFor("untracked")).toEqual({ letter: "U", tone: "success", struck: false });
    expect(badgeFor("deleted")).toEqual({ letter: "D", tone: "error", struck: true });
    expect(badgeFor("added")).toEqual({ letter: "A", tone: "success", struck: false });
    expect(badgeFor("renamed")).toEqual({ letter: "R", tone: "info", struck: false });
    expect(badgeFor("conflicted")).toEqual({ letter: "C", tone: "error", struck: false });
  });

  it("gives no badge to a state it does not know", () => {
    expect(badgeFor("tangled")).toBeNull();
  });

  it("puts the path of a file of the repository under the root of the project", () => {
    expect(absoluteGitPath("/workspace", "src/app.ts")).toBe("/workspace/src/app.ts");
    expect(absoluteGitPath("/workspace", "/already/absolute.ts")).toBe("/already/absolute.ts");
    expect(absoluteGitPath("", "src/app.ts")).toBe("src/app.ts");
  });

  it("holds the badge of every file under the path of the tree", () => {
    const badges = gitBadges("/workspace", [
      { path: "src/app.ts", status: "modified" },
      { path: "src/util.ts", status: "untracked" },
      { path: "README.md", status: "deleted" },
      { path: "notes.txt", status: "tangled" },
    ]);

    expect(badges.get("/workspace/src/app.ts")?.letter).toBe("M");
    expect(badges.get("/workspace/src/util.ts")?.letter).toBe("U");
    expect(badges.get("/workspace/README.md")?.letter).toBe("D");
    expect(badges.has("/workspace/notes.txt")).toBe(false);
    expect(badges.size).toBe(3);
  });

  it("holds no badge for a repository that changed nothing", () => {
    expect(gitBadges("/workspace", []).size).toBe(0);
  });
});
