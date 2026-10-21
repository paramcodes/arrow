import { beforeEach, describe, expect, it } from "vitest";

import { resetTerminalStore, useTerminalStore } from "./terminal";

/**
 * The terminal tabs of the shell.
 *
 * The store is one mutable object, so every case resets it first. A case that
 * only passes because another case left a tab open is not a case: it fails
 * the moment the order of the file changes.
 */
describe("the terminal store", () => {
  beforeEach(() => {
    resetTerminalStore();
  });

  it("opens with no terminal", () => {
    const state = useTerminalStore.getState();

    expect(state.tabs).toEqual([]);
    expect(state.activeId).toBeNull();
  });

  it("opens a tab and makes it active", () => {
    const id = useTerminalStore.getState().openTab();
    const state = useTerminalStore.getState();

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toEqual({ id, title: "Terminal 1" });
    expect(state.activeId).toBe(id);
  });

  it("switches between tabs", () => {
    const first = useTerminalStore.getState().openTab();
    const second = useTerminalStore.getState().openTab();

    expect(useTerminalStore.getState().activeId).toBe(second);

    useTerminalStore.getState().setActive(first);
    expect(useTerminalStore.getState().activeId).toBe(first);
  });

  it("ignores a tab that is not open", () => {
    const first = useTerminalStore.getState().openTab();
    useTerminalStore.getState().setActive("term-missing");

    expect(useTerminalStore.getState().activeId).toBe(first);
  });

  it("activates the neighbour of a closed tab", () => {
    const first = useTerminalStore.getState().openTab();
    const second = useTerminalStore.getState().openTab();
    const third = useTerminalStore.getState().openTab();

    useTerminalStore.getState().setActive(second);
    useTerminalStore.getState().closeTab(second);

    expect(useTerminalStore.getState().tabs.map((tab) => tab.id)).toEqual([first, third]);
    expect(useTerminalStore.getState().activeId).toBe(third);
  });

  it("activates the previous tab when the last one closes", () => {
    const first = useTerminalStore.getState().openTab();
    const second = useTerminalStore.getState().openTab();

    useTerminalStore.getState().closeTab(second);

    expect(useTerminalStore.getState().activeId).toBe(first);
  });

  it("leaves the active tab alone when another tab closes", () => {
    const first = useTerminalStore.getState().openTab();
    const second = useTerminalStore.getState().openTab();

    useTerminalStore.getState().closeTab(first);

    expect(useTerminalStore.getState().activeId).toBe(second);
  });

  it("opens a fresh tab after every tab has closed", () => {
    const first = useTerminalStore.getState().openTab();
    useTerminalStore.getState().closeTab(first);

    const second = useTerminalStore.getState().openTab();

    expect(useTerminalStore.getState().tabs).toHaveLength(1);
    expect(second).not.toBe(first);
    expect(useTerminalStore.getState().activeId).toBe(second);
  });

  it("keeps no tab after a reset", () => {
    useTerminalStore.getState().openTab();
    resetTerminalStore();

    expect(useTerminalStore.getState().tabs).toEqual([]);
    expect(useTerminalStore.getState().activeId).toBeNull();
  });
});
