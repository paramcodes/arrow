import type { FileEntry } from "@arrow/types";

import { invokeCommand, isTauriHost } from "../lib/tauri";

/**
 * The file system of the workspace, as the shell sees it.
 *
 * The desktop app runs inside a Tauri webview, where every call lands in the
 * Rust commands of `apps/desktop/src-tauri/src/commands/fs.rs`. The same code
 * also runs in a plain browser, where no Tauri host exists. The browser gets a
 * small fixture workspace held in memory, so Playwright can drive the tree,
 * the tabs and the save path without a host.
 *
 * The fixture never lives in the Rust side, and a save in the browser writes
 * to the fixture, so the suite can read back what it saved.
 */

/** The root the browser fixture lives under. */
export const FIXTURE_ROOT = "/workspace";

/** The root of the workspace, as the frontend names it. */
export function workspaceRoot(): string {
  return isTauriHost() ? "" : FIXTURE_ROOT;
}

/** The content of every fixture file, keyed by path. */
const fixtureDirectories = new Set<string>([
  FIXTURE_ROOT,
  `${FIXTURE_ROOT}/src`,
  `${FIXTURE_ROOT}/src/components`,
]);

const fixtureFiles = new Map<string, string>([
  [
    `${FIXTURE_ROOT}/src/app.ts`,
    `import { greet } from "./util";

export function main(name: string): string {
  return greet(name);
}
`,
  ],
  [
    `${FIXTURE_ROOT}/src/util.ts`,
    `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`,
  ],
  [
    `${FIXTURE_ROOT}/src/main.rs`,
    `fn main() {
    let answer: i32 = 42;
    println!("the answer is {}", answer);
}
`,
  ],
  [
    `${FIXTURE_ROOT}/src/components/Button.tsx`,
    `export function Button() {
  return <button type="button">Arrow</button>;
}
`,
  ],
  [`${FIXTURE_ROOT}/README.md`, "# Arrow\n\nA fixture workspace for the browser build.\n"],
  [`${FIXTURE_ROOT}/package.json`, '{\n  "name": "fixture-workspace",\n  "private": true\n}\n'],
]);

/** The separator a path uses. */
function separator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/** The name of the last segment of a path. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The directory of a path. */
export function dirName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? "" : path.slice(0, cut);
}

/** Join two segments of a path. */
export function joinPath(directory: string, name: string): string {
  if (directory === "") return name;
  return `${directory.replace(/[\\/]$/, "")}${separator(directory)}${name}`;
}

/** The children of a fixture directory. */
function fixtureEntries(directory: string): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const path of fixtureDirectories) {
    if (path !== directory && dirName(path) === directory) {
      entries.push({ name: baseName(path), path, isDirectory: true });
    }
  }

  for (const path of fixtureFiles.keys()) {
    if (dirName(path) === directory) {
      entries.push({ name: baseName(path), path, isDirectory: false });
    }
  }

  return entries.sort(
    (left, right) =>
      Number(right.isDirectory) - Number(left.isDirectory) ||
      left.name.toLowerCase().localeCompare(right.name.toLowerCase()),
  );
}

/** The entries of a directory: the Tauri command, or the browser fixture. */
export async function readDirectory(path: string): Promise<FileEntry[]> {
  if (!isTauriHost()) {
    if (!fixtureDirectories.has(path)) {
      throw new Error(`${path}: the directory does not exist`);
    }
    return fixtureEntries(path);
  }

  const entries = await invokeCommand<FileEntry[]>("read_directory", { path });
  if (!entries) throw new Error(`${path}: the shell did not answer`);
  return entries;
}

/** The text of a file: the Tauri command, or the browser fixture. */
export async function readFile(path: string): Promise<string> {
  if (!isTauriHost()) {
    const content = fixtureFiles.get(path);
    if (content === undefined) throw new Error(`${path}: the file does not exist`);
    return content;
  }

  const content = await invokeCommand<string>("read_file", { path });
  if (content === undefined) throw new Error(`${path}: the shell did not answer`);
  return content;
}

/** Write the text of a file to the disk, or to the browser fixture. */
export async function writeFile(path: string, contents: string): Promise<void> {
  if (!isTauriHost()) {
    fixtureFiles.set(path, contents);
    return;
  }

  await invokeCommand<null>("write_file", { path, contents });
}

/** Create a file, or a directory when `directory` is true. */
export async function createEntry(path: string, directory: boolean): Promise<void> {
  if (!isTauriHost()) {
    if (fixtureFiles.has(path) || fixtureDirectories.has(path)) {
      throw new Error(`${path}: the entry already exists`);
    }
    if (directory) {
      fixtureDirectories.add(path);
    } else {
      fixtureFiles.set(path, "");
    }
    return;
  }

  await invokeCommand<null>("create_entry", { path, directory });
}

/** Delete a file or a directory with everything inside it. */
export async function deleteEntry(path: string): Promise<void> {
  if (!isTauriHost()) {
    if (fixtureDirectories.delete(path)) {
      const prefix = `${path}/`;
      for (const child of Array.from(fixtureDirectories)) {
        if (child.startsWith(prefix)) fixtureDirectories.delete(child);
      }
      for (const child of Array.from(fixtureFiles.keys())) {
        if (child.startsWith(prefix)) fixtureFiles.delete(child);
      }
      return;
    }
    if (!fixtureFiles.delete(path)) throw new Error(`${path}: the entry does not exist`);
    return;
  }

  await invokeCommand<null>("delete_entry", { path });
}

/** Move an entry to another path. */
export async function renameEntry(from: string, to: string): Promise<void> {
  if (!isTauriHost()) {
    const content = fixtureFiles.get(from);
    if (content !== undefined) {
      if (fixtureFiles.has(to) || fixtureDirectories.has(to)) {
        throw new Error(`${to}: the entry already exists`);
      }
      fixtureFiles.delete(from);
      fixtureFiles.set(to, content);
      return;
    }

    if (!fixtureDirectories.has(from)) throw new Error(`${from}: the entry does not exist`);
    if (fixtureFiles.has(to) || fixtureDirectories.has(to)) {
      throw new Error(`${to}: the entry already exists`);
    }

    for (const path of Array.from(fixtureDirectories)) {
      if (path === from || path.startsWith(`${from}/`)) {
        fixtureDirectories.delete(path);
        fixtureDirectories.add(`${to}${path.slice(from.length)}`);
      }
    }
    for (const [path, text] of Array.from(fixtureFiles.entries())) {
      if (path.startsWith(`${from}/`)) {
        fixtureFiles.delete(path);
        fixtureFiles.set(`${to}${path.slice(from.length)}`, text);
      }
    }
    return;
  }

  await invokeCommand<null>("rename_entry", { from, to });
}
