import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useLayoutStore,
} from "./layout";

/**
 * The layout store holds the facts of the shell, so the shell behaves the
 * same way in the window and in a test.
 */
describe("the layout store", () => {
  it("opens with a sidebar and a closed bottom panel", () => {
    const state = useLayoutStore.getState();

    expect(state.sidebarOpen).toBe(true);
    expect(state.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(state.bottomPanelOpen).toBe(false);
    expect(state.bottomPanelHeight).toBe(DEFAULT_BOTTOM_PANEL_HEIGHT);
    expect(state.activePanel).toBe("explorer");
  });

  it("toggles the sidebar", () => {
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarOpen).toBe(false);

    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarOpen).toBe(true);
  });

  it("toggles the bottom panel", () => {
    useLayoutStore.getState().toggleBottomPanel();
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(true);

    useLayoutStore.getState().toggleBottomPanel();
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false);
  });

  it("switches the active panel", () => {
    useLayoutStore.getState().setActivePanel("git");
    expect(useLayoutStore.getState().activePanel).toBe("git");

    useLayoutStore.getState().setActivePanel("search");
    expect(useLayoutStore.getState().activePanel).toBe("search");
  });

  it("keeps the sidebar width inside its bounds", () => {
    useLayoutStore.getState().setSidebarWidth(MIN_SIDEBAR_WIDTH - 100);
    expect(useLayoutStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);

    useLayoutStore.getState().setSidebarWidth(MAX_SIDEBAR_WIDTH + 100);
    expect(useLayoutStore.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);

    useLayoutStore.getState().setSidebarWidth(300);
    expect(useLayoutStore.getState().sidebarWidth).toBe(300);
  });

  it("persists the facts of the layout", () => {
    const options = useLayoutStore.persist.getOptions();

    expect(options.name).toBe("arrow.layout");
    expect(options.storage).toBeDefined();
  });
});
