import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * The panels the activity bar can show in the sidebar.
 *
 * The store owns the workspace facts of the shell, so it lives in Zustand.
 * ADR-0004 records the tiering: a workspace fact is a Zustand store.
 */
export type ActivePanel = "explorer" | "search" | "git" | "chat" | "settings";

/** The narrowest the sidebar may become. */
export const MIN_SIDEBAR_WIDTH = 160;

/** The widest the sidebar may become. */
export const MAX_SIDEBAR_WIDTH = 640;

/** The shortest the bottom panel may become. */
export const MIN_BOTTOM_PANEL_HEIGHT = 80;

/** The tallest the bottom panel may become. */
export const MAX_BOTTOM_PANEL_HEIGHT = 640;

/** The width the sidebar opens with. */
export const DEFAULT_SIDEBAR_WIDTH = 240;

/** The height the bottom panel opens with. */
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 220;

/** The facts of the layout, without the actions that change them. */
export interface LayoutFacts {
  readonly sidebarOpen: boolean;
  readonly sidebarWidth: number;
  readonly bottomPanelOpen: boolean;
  readonly bottomPanelHeight: number;
  readonly activePanel: ActivePanel;
}

/** The layout store of the shell. */
export interface LayoutState extends LayoutFacts {
  readonly toggleSidebar: () => void;
  readonly toggleBottomPanel: () => void;
  readonly setActivePanel: (panel: ActivePanel) => void;
  readonly setSidebarWidth: (width: number) => void;
  readonly setBottomPanelHeight: (height: number) => void;
}

/** The facts the store keeps across a reload. */
type PersistedLayout = LayoutFacts;

/**
 * The memory of a browser that has no storage.
 *
 * The frontend boots in a plain browser, so the store has to work when the
 * storage of the browser is missing, such as in a unit test.
 */
const memory = new Map<string, string>();

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The storage of the layout.
 *
 * The panel state has to survive a reload, because a developer reloads the
 * window often and a shell that forgets its own layout is a shell that
 * fights the person using it.
 */
const storage: StateStorage = {
  getItem: (name) => browserStorage()?.getItem(name) ?? memory.get(name) ?? null,
  setItem: (name, value) => {
    const store = browserStorage();
    if (store) {
      store.setItem(name, value);
      return;
    }
    memory.set(name, value);
  },
  removeItem: (name) => {
    const store = browserStorage();
    if (store) {
      store.removeItem(name);
      return;
    }
    memory.delete(name);
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The layout store of the shell.
 *
 * The facts live in one store, so a panel, the activity bar and the keyboard
 * shortcuts always read the same state. The store persists, so the layout
 * survives a reload.
 */
export const useLayoutStore = create<LayoutState>()(
  persist<LayoutState, [], [], PersistedLayout>(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      bottomPanelOpen: false,
      bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
      activePanel: "explorer",
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleBottomPanel: () => set((state) => ({ bottomPanelOpen: !state.bottomPanelOpen })),
      setActivePanel: (panel) => set({ activePanel: panel }),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH) }),
      setBottomPanelHeight: (height) =>
        set({ bottomPanelHeight: clamp(height, MIN_BOTTOM_PANEL_HEIGHT, MAX_BOTTOM_PANEL_HEIGHT) }),
    }),
    {
      name: "arrow.layout",
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        bottomPanelOpen: state.bottomPanelOpen,
        bottomPanelHeight: state.bottomPanelHeight,
        activePanel: state.activePanel,
      }),
    },
  ),
);
