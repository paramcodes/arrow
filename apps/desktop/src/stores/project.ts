import { create } from "zustand";

import {
  EMPTY_GIT_DIFF_STAT,
  EMPTY_GIT_STATUS,
  type GitDiffStat,
  type GitStatus,
} from "../lib/git";
import {
  gitBranch,
  gitDiffStat,
  gitStatus,
  pickFolder,
  unwatch,
  watchDirectory,
} from "../lib/tauri";

/**
 * The facts of the project that is open.
 *
 * ADR-0004 puts the facts of the workspace in Zustand: the root of the
 * project, the branch it is on and the state of its repository are facts
 * that every part of the window reads. The store holds them once, so the
 * status bar, the tree and the shell read the same numbers and none of them
 * asks the shell for the status of a single file.
 *
 * The shell owns the disk and git. The store asks the shell through the
 * boundary of `apps/desktop/src/lib/tauri.ts` and keeps what the shell
 * answers. It never reads the disk and never runs git itself.
 */

/** The facts of the project, without the actions that change them. */
export interface ProjectFacts {
  /** The root of the project that is open, or null when none is open. */
  readonly rootPath: string | null;
  /** The branch of the repository, or null when it is unknown. */
  readonly branch: string | null;
  /** The state of the repository. */
  readonly status: GitStatus;
  /** The counts of the diff of the repository. */
  readonly diffStat: GitDiffStat;
  /** The id of the watch of the root, or null when nothing is watched. */
  readonly watchId: string | null;
  /** The message of the last failure, or null. */
  readonly error: string | null;
}

/** The project store of the shell. */
export interface ProjectState extends ProjectFacts {
  /** Open a project: watch its root and read the state of its repository. */
  readonly openProject: (path: string) => Promise<void>;
  /** Read the state of the repository of the project that is open again. */
  readonly refreshGitStatus: () => Promise<void>;
  /** Stop the watch and forget the project. */
  readonly closeProject: () => Promise<void>;
}

/** The facts the store holds when the window opens. */
const INITIAL_FACTS: ProjectFacts = {
  rootPath: null,
  branch: null,
  status: EMPTY_GIT_STATUS,
  diffStat: EMPTY_GIT_DIFF_STAT,
  watchId: null,
  error: null,
};

/** The message of a failure, as the reader sees it. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The project store of the shell.
 *
 * The store owns the life of the watch: it starts one when a project opens
 * and stops it when the project closes or another one opens. The tree of the
 * frontend listens for the changes of the watch, and the store listens for
 * them too, because a change of the disk can change the state of the
 * repository.
 */
export const useProjectStore = create<ProjectState>()((set, get) => ({
  ...INITIAL_FACTS,

  openProject: async (path: string) => {
    const previous = get().watchId;
    if (previous !== null) {
      await unwatch(previous).catch(() => undefined);
    }

    set({ ...INITIAL_FACTS, rootPath: path });

    try {
      const watchId = await watchDirectory(path);
      set({ watchId: watchId ?? null });
    } catch (failure) {
      set({ error: messageOf(failure) });
      return;
    }

    await get().refreshGitStatus();
  },

  refreshGitStatus: async () => {
    const root = get().rootPath;
    if (root === null) return;

    try {
      const status = await gitStatus(root);
      const branch = await gitBranch(root).catch(() => undefined);
      const diffStat = await gitDiffStat(root).catch(() => undefined);

      set({
        status: status ?? EMPTY_GIT_STATUS,
        branch: branch ?? status?.branch ?? null,
        diffStat: diffStat ?? EMPTY_GIT_DIFF_STAT,
        error: null,
      });
    } catch (failure) {
      set({ error: messageOf(failure) });
    }
  },

  closeProject: async () => {
    const watchId = get().watchId;
    if (watchId !== null) {
      await unwatch(watchId).catch(() => undefined);
    }

    set({ ...INITIAL_FACTS });
  },
}));

/**
 * Puts the project back the way a new window opens it.
 *
 * The store is one mutable object, so a test that changes it changes it for
 * every test that runs after it. Every test of the store resets it first.
 */
export function resetProjectStore(): void {
  useProjectStore.setState({ ...INITIAL_FACTS });
}

/**
 * Asks the reader for a folder and opens it as the project.
 *
 * The picker is the dialog plugin of Tauri, which the Rust shell registers.
 * The reader may cancel it, and a cancelled picker leaves the project as it
 * was.
 *
 * The path of the folder that was picked, or null when the reader cancelled.
 */
export async function chooseProject(): Promise<string | null> {
  const path = await pickFolder();
  if (path === null) return null;

  await useProjectStore.getState().openProject(path);

  return path;
}
