/**
 * The git facts of a project, as the frontend reads them.
 *
 * The Rust shell owns git. It reads the repository with `libgit2` and answers
 * with the shapes below, and the frontend never runs git itself. The names of
 * the fields are the contract of the two halves of the session: `branch`,
 * `modified`, `staged`, `untracked`, `deleted` and `files`, and the file
 * carries a `path` and a `status`.
 *
 * The path of a file is relative to the root of the repository, because that
 * is what git reports. The tree of the frontend holds absolute paths, so the
 * badge of a file is looked up under the root of the project.
 */

/** The state of one file of a repository. */
export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "conflicted";

/** One file of a repository, and the state it is in. */
export interface GitFile {
  /** The path of the file, relative to the root of the repository. */
  readonly path: string;
  /** The state of the file. */
  readonly status: GitFileStatus;
}

/** The status of a repository. */
export interface GitStatus {
  /** The branch the repository is on. */
  readonly branch: string;
  /** The number of files whose content changed. */
  readonly modified: number;
  /** The number of files that wait for the next commit. */
  readonly staged: number;
  /** The number of files the repository does not track. */
  readonly untracked: number;
  /** The number of files that are gone. */
  readonly deleted: number;
  /** The state of every file that is not as it was. */
  readonly files: readonly GitFile[];
}

/** The counts of the diff of a repository. */
export interface GitDiffStat {
  /** The number of files the diff touches. */
  readonly filesChanged: number;
  /** The number of lines the diff adds. */
  readonly insertions: number;
  /** The number of lines the diff removes. */
  readonly deletions: number;
}

/** The status of a repository that holds nothing. */
export const EMPTY_GIT_STATUS: GitStatus = {
  branch: "",
  modified: 0,
  staged: 0,
  untracked: 0,
  deleted: 0,
  files: [],
};

/** The counts of a diff that holds nothing. */
export const EMPTY_GIT_DIFF_STAT: GitDiffStat = {
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
};

/**
 * The badge a file wears in the tree.
 *
 * A badge is a letter and the tone of the palette it wears. The letter is
 * the state of the file in one character, the way a reader of a diff reads
 * it, and the tone comes from a token of the theme, so no component holds a
 * color of its own.
 */
export interface GitBadge {
  /** The letter of the badge. */
  readonly letter: string;
  /** The token of the palette the badge wears. */
  readonly tone: "warning" | "success" | "error" | "info";
  /** True when the name of the file is struck through. */
  readonly struck: boolean;
}

/** The badge of every state a file can be in. */
const BADGES: Readonly<Record<GitFileStatus, GitBadge>> = {
  modified: { letter: "M", tone: "warning", struck: false },
  added: { letter: "A", tone: "success", struck: false },
  deleted: { letter: "D", tone: "error", struck: true },
  untracked: { letter: "U", tone: "success", struck: false },
  renamed: { letter: "R", tone: "info", struck: false },
  conflicted: { letter: "C", tone: "error", struck: false },
};

/**
 * The badge of a state, or null when the state is not one the tree knows.
 *
 * A state that no badge names is a state the shell added after this table was
 * written. Such a file wears no badge, because a letter that means nothing is
 * worse than no letter at all.
 */
export function badgeFor(status: string): GitBadge | null {
  const badge = BADGES[status as GitFileStatus];
  return badge ?? null;
}

/** The path of a file of the repository, as the tree of the frontend names it. */
export function absoluteGitPath(root: string, relative: string): string {
  if (root === "") return relative;
  if (relative.startsWith("/")) return relative;
  return `${root.replace(/[\\/]$/, "")}/${relative}`;
}

/**
 * The badge of every file of the repository, keyed by the path of the tree.
 *
 * The map is built once for the whole status, so a row of the tree reads its
 * badge out of a map and never asks the shell for the status of its own file.
 */
export function gitBadges(root: string, files: readonly GitFile[]): ReadonlyMap<string, GitBadge> {
  const badges = new Map<string, GitBadge>();

  for (const file of files) {
    const badge = badgeFor(file.status);
    if (!badge) continue;
    badges.set(absoluteGitPath(root, file.path), badge);
  }

  return badges;
}
