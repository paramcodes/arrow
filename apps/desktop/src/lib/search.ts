import { baseName, joinPath, readDirectory, readFile, workspaceRoot } from "../hooks/fileSystem";
import { invokeCommand, isTauriHost } from "./tauri";

/**
 * The search of the workspace.
 *
 * In the window the shell runs the search and the walk in Rust, where `rg` is
 * used when it is on the machine and `grep` answers when it is not. In a plain
 * browser there is no host, so the same two calls read the fixture workspace
 * through the file-system boundary, and the palette and the search panel are
 * driven by Playwright without a backend.
 *
 * A search result names a file, a line and a column, so the editor can open
 * the file at the match instead of at the top.
 */

/** One match of a project search. */
export interface ProjectSearchMatch {
  /** The path of the file, relative to the root of the workspace. */
  readonly path: string;
  /** The line of the match, counting from one. */
  readonly line: number;
  /** The column of the match, counting from one. */
  readonly column: number;
  /** The text of the line the match sits on. */
  readonly text: string;
}

/** The answer of a project search. */
export interface ProjectSearchResult {
  /** The matches of the query. */
  readonly matches: readonly ProjectSearchMatch[];
  /** True when the shell found more matches than it returned. */
  readonly truncated: boolean;
  /** The engine that answered: `rg`, `grep` or the browser fixture. */
  readonly engine: string;
}

/** How many matches one search returns at most. */
export const MAX_SEARCH_MATCHES = 200;

/** How deep the browser walks the fixture workspace. */
const MAX_DEPTH = 16;

/** How many files the browser walk holds at most. */
const MAX_FILES = 5_000;

/** The directories a search never enters. */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".worktrees",
  "coverage",
  "vendor",
]);

/** The path of a file relative to the root of the workspace. */
function relativeTo(root: string, path: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Walk the fixture workspace and collect its files. */
async function walkFixture(
  root: string,
  directory: string,
  depth: number,
  files: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

  const entries = await readDirectory(directory);

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    if (entry.isDirectory) {
      const name = baseName(entry.path);
      if (SKIPPED_DIRECTORIES.has(name) || name.startsWith(".")) continue;
      await walkFixture(root, entry.path, depth + 1, files);
      continue;
    }
    files.push(relativeTo(root, entry.path));
  }
}

/**
 * The files of the workspace, relative to its root.
 *
 * The quick-open ranks these paths, so the walk leaves out the directories of
 * generated output and the hidden ones.
 */
export async function listProjectFiles(root: string = workspaceRoot()): Promise<readonly string[]> {
  if (isTauriHost()) {
    const files = await invokeCommand<string[]>("list_files", { root });
    if (!files) throw new Error("the shell did not answer the file list");
    return files;
  }

  const files: string[] = [];
  await walkFixture(root, root, 0, files);
  files.sort();
  return files;
}

/** Search the fixture workspace, one file at a time. */
async function searchFixture(root: string, query: string): Promise<ProjectSearchResult> {
  const files = await listProjectFiles(root);
  const matches: ProjectSearchMatch[] = [];
  let truncated = false;

  for (const file of files) {
    if (matches.length >= MAX_SEARCH_MATCHES) {
      truncated = true;
      break;
    }

    let content: string;
    try {
      content = await readFile(joinPath(root, file));
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const column = line.indexOf(query) + 1;
      if (column === 0) continue;
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true;
        break;
      }
      matches.push({ path: file, line: index + 1, column, text: line });
    }
  }

  return { matches, truncated, engine: "fixture" };
}

/**
 * Search the text of every file of the workspace.
 *
 * The query is a fixed string: a query that holds a regular expression
 * metacharacter searches for that character.
 */
export async function searchProject(
  root: string = workspaceRoot(),
  query: string,
): Promise<ProjectSearchResult> {
  if (query.trim() === "") {
    return { matches: [], truncated: false, engine: isTauriHost() ? "rg" : "fixture" };
  }

  if (isTauriHost()) {
    const answer = await invokeCommand<ProjectSearchResult>("search_files", {
      root,
      query,
      maxResults: MAX_SEARCH_MATCHES,
    });
    if (!answer) throw new Error("the shell did not answer the search");
    return answer;
  }

  return searchFixture(root, query);
}
