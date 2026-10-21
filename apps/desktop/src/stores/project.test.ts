import { beforeEach, describe, expect, it } from "vitest";

import { shellStub } from "../lib/tauri";
import { resetProjectStore, useProjectStore } from "./project";

/**
 * The project store.
 *
 * The store holds the facts of the project that is open: the root, the branch
 * and the state of the repository. The shell owns the disk and git, and the
 * store reads them through the boundary of the frontend, which answers from a
 * fixture in a browser.
 *
 * The store is one mutable object, so every test resets it before it runs.
 */

/** The number of calls the stub had recorded when the test started. */
function mark(): number {
  return shellStub.commandLog.length;
}

/** The calls the stub recorded after the mark. */
function callsSince(start: number) {
  return shellStub.commandLog.slice(start);
}

describe("the project store", () => {
  beforeEach(() => {
    resetProjectStore();
  });

  it("opens with no project", () => {
    const state = useProjectStore.getState();

    expect(state.rootPath).toBeNull();
    expect(state.branch).toBeNull();
    expect(state.status.modified).toBe(0);
    expect(state.status.files).toHaveLength(0);
    expect(state.watchId).toBeNull();
    expect(state.error).toBeNull();
  });

  it("opens a project and reads the state of its repository", async () => {
    await useProjectStore.getState().openProject("/workspace");

    const state = useProjectStore.getState();

    expect(state.rootPath).toBe("/workspace");
    expect(state.branch).toBe("main");
    expect(state.status.modified).toBe(1);
    expect(state.status.untracked).toBe(1);
    expect(state.status.files.map((file) => file.path)).toEqual([
      "src/app.ts",
      "src/util.ts",
      "README.md",
    ]);
    expect(state.watchId).not.toBeNull();
    expect(state.error).toBeNull();
  });

  it("asks the shell to watch the root of the project", async () => {
    const start = mark();

    await useProjectStore.getState().openProject("/workspace");

    const calls = callsSince(start).filter((call) => call.command === "watch_directory");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.path).toBe("/workspace");
  });

  it("reads the state of the repository again when it is asked to", async () => {
    const start = mark();

    await useProjectStore.getState().openProject("/workspace");
    await useProjectStore.getState().refreshGitStatus();

    const calls = callsSince(start).filter((call) => call.command === "git_status");

    expect(calls).toHaveLength(2);
  });

  it("stops the watch when the project closes", async () => {
    const start = mark();

    await useProjectStore.getState().openProject("/workspace");
    const watchId = useProjectStore.getState().watchId;

    await useProjectStore.getState().closeProject();

    const state = useProjectStore.getState();
    const stops = callsSince(start).filter((call) => call.command === "unwatch");

    expect(state.rootPath).toBeNull();
    expect(state.watchId).toBeNull();
    expect(stops).toHaveLength(1);
    expect(stops[0]?.args.watch_id).toBe(watchId);
  });

  it("stops the watch of the project it replaces", async () => {
    const start = mark();

    await useProjectStore.getState().openProject("/workspace");
    await useProjectStore.getState().openProject("/other");

    const stops = callsSince(start).filter((call) => call.command === "unwatch");

    expect(stops).toHaveLength(1);
    expect(useProjectStore.getState().rootPath).toBe("/other");
  });
});
