/**
 * The workspace the demo recordings open.
 *
 * The workspace is generated on every run under the system temporary
 * directory, so the repository never holds a scratch folder and the tree of
 * the repository is clean after a recording. It is a small TypeScript project
 * on a git branch with one modified file, one untracked file and one deleted
 * file, so the tree has a badge of every tone the product paints and the
 * status bar has counts to show.
 *
 * The files are written once, committed, and then changed, so `git status`
 * of the workspace answers the same way on every run.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

/** The name of the branch the demo workspace is on. */
export const BRANCH = "demo";

/** The entries of the committed project, keyed by their path. */
const COMMITTED = {
  "package.json": `{
  "name": "arrow-demo",
  "private": true,
  "type": "module"
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext"
  }
}
`,
  "README.md": `# Arrow demo

A generated workspace for the recordings in docs/demo.
`,
  "src/sum.ts": `export function total(a: number, b: number): number {
  return a + b;
}
`,
  "src/greet.ts": `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`,
  "src/old.ts": `export const removed = true;
`,
};

/** The file the recording changes, to show the M badge of the tree. */
const MODIFIED = "src/greet.ts";

/** The file the recording adds, to show the U badge of the tree. */
const UNTRACKED = "src/notes.md";

/** The file the recording deletes, to show the D badge of the tree. */
const DELETED = "src/old.ts";

/** Run git in the workspace, and fail when it fails. */
function git(root, args) {
  const result = spawnSync(
    "git",
    ["-c", "user.email=demo@arrow.invalid", "-c", "user.name=Arrow demo", ...args],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Write the workspace at `root`, commit it, then leave it with changes.
 *
 * The directory is removed first when it exists, so a second call against the
 * same path starts from the committed project and not from the changes of the
 * run before.
 */
export function createWorkspace(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "src"), { recursive: true });

  for (const [path, text] of Object.entries(COMMITTED)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  git(root, ["init", "-q", "-b", BRANCH]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "the demo workspace"]);

  // The changes the tree paints: one modified file, one file the repository
  // does not track, and one file that is gone.
  writeFileSync(
    join(root, MODIFIED),
    `export function greet(name: string): string {
  const greeting = \`Hello, \${name}\`;
  return greeting;
}
`,
  );
  writeFileSync(join(root, UNTRACKED), "# notes\n\nThe tree shows this file as untracked.\n");
  rmSync(join(root, DELETED));

  return root;
}

/**
 * Add a file to the workspace while a recording runs.
 *
 * The watcher of the real window reports the change, and the tree paints the
 * new row without a refresh. The recorder calls this from outside the
 * application, which is what makes the clip a proof of the watcher.
 */
export function addWatchedFile(root, name, text) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/**
 * Touch the modified file again, so the watcher has a change of a tracked
 * file to report while the tree paints its badge.
 */
export function touchModifiedFile(root) {
  const path = join(root, MODIFIED);
  writeFileSync(
    path,
    `export function greet(name: string): string {
  const greeting = \`Hello, \${name}\`;
  return greeting.trim();
}
`,
  );
  return path;
}
