import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore, resetEditorStore } from "./editor";

/**
 * The editor store.
 *
 * The store decides which file a tab holds, when a tab is dirty and when a save
 * reaches the disk. The disk is mocked: a store test is about the transitions
 * of the store, and a real write would test the file system instead.
 *
 * Every case resets the store before it runs, the way the layout store does. A
 * test that passes only because another test left a file open is not a test.
 */

const files = new Map<string, string>([
  ["/workspace/src/app.ts", "const answer = 42;\n"],
  ["/workspace/src/main.rs", "fn main() {}\n"],
  ["/workspace/LICENSE", "Arrow\n"],
]);

const writeFile = vi.fn(async (path: string, content: string) => {
  files.set(path, content);
});

vi.mock("../hooks/fileSystem", () => ({
  readFile: async (path: string) => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`${path}: the file does not exist`);
    return content;
  },
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

describe("the editor store", () => {
  beforeEach(() => {
    resetEditorStore();
    writeFile.mockClear();
  });

  it("opens a file with the language of its extension", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");
    const state = useEditorStore.getState();

    expect(state.openFiles).toHaveLength(1);
    expect(state.openFiles[0]?.path).toBe("/workspace/src/app.ts");
    expect(state.openFiles[0]?.languageId).toBe("typescript");
    expect(state.openFiles[0]?.content).toBe("const answer = 42;\n");
    expect(state.openFiles[0]?.dirty).toBe(false);
    expect(state.activePath).toBe("/workspace/src/app.ts");
  });

  it("opens a file it cannot name as plain text", async () => {
    await useEditorStore.getState().openFile("/workspace/LICENSE");

    expect(useEditorStore.getState().openFiles[0]?.languageId).toBe("plaintext");
  });

  it("activates a file that is already open instead of opening it twice", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");
    await useEditorStore.getState().openFile("/workspace/src/main.rs");

    await useEditorStore.getState().openFile("/workspace/src/app.ts");

    expect(useEditorStore.getState().openFiles).toHaveLength(2);
    expect(useEditorStore.getState().activePath).toBe("/workspace/src/app.ts");
  });

  it("closes a tab and activates its neighbour", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");
    await useEditorStore.getState().openFile("/workspace/src/main.rs");

    useEditorStore.getState().closeFile("/workspace/src/main.rs");

    expect(useEditorStore.getState().openFiles.map((file) => file.path)).toEqual([
      "/workspace/src/app.ts",
    ]);
    expect(useEditorStore.getState().activePath).toBe("/workspace/src/app.ts");
  });

  it("closes the last tab without an active file", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");

    useEditorStore.getState().closeFile("/workspace/src/app.ts");

    expect(useEditorStore.getState().openFiles).toHaveLength(0);
    expect(useEditorStore.getState().activePath).toBeNull();
  });

  it("marks a file dirty when its text changes", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");

    useEditorStore.getState().updateContent("/workspace/src/app.ts", "const answer = 43;\n");

    expect(useEditorStore.getState().openFiles[0]?.dirty).toBe(true);
    expect(useEditorStore.getState().openFiles[0]?.content).toBe("const answer = 43;\n");
  });

  it("writes a dirty file to the disk and clears the flag", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");
    useEditorStore.getState().updateContent("/workspace/src/app.ts", "const answer = 43;\n");

    await useEditorStore.getState().saveFile("/workspace/src/app.ts");

    expect(writeFile).toHaveBeenCalledWith("/workspace/src/app.ts", "const answer = 43;\n");
    expect(files.get("/workspace/src/app.ts")).toBe("const answer = 43;\n");
    expect(useEditorStore.getState().openFiles[0]?.dirty).toBe(false);
  });

  it("saves every dirty file and leaves a clean one alone", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");
    await useEditorStore.getState().openFile("/workspace/src/main.rs");
    useEditorStore.getState().updateContent("/workspace/src/main.rs", "fn main() { }\n");

    await useEditorStore.getState().saveAll();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("/workspace/src/main.rs", "fn main() { }\n");
    expect(useEditorStore.getState().openFiles.every((file) => !file.dirty)).toBe(true);
  });

  it("moves the path of an open file after a rename", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");

    useEditorStore.getState().remapPath("/workspace/src/app.ts", "/workspace/src/index.ts");

    expect(useEditorStore.getState().openFiles[0]?.path).toBe("/workspace/src/index.ts");
    expect(useEditorStore.getState().openFiles[0]?.languageId).toBe("typescript");
    expect(useEditorStore.getState().activePath).toBe("/workspace/src/index.ts");
  });

  it("leaves no state behind for the next test", async () => {
    await useEditorStore.getState().openFile("/workspace/src/app.ts");
    useEditorStore.getState().updateContent("/workspace/src/app.ts", "changed\n");

    resetEditorStore();

    expect(useEditorStore.getState().openFiles).toHaveLength(0);
    expect(useEditorStore.getState().activePath).toBeNull();
  });
});
