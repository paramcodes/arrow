import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * The settings of the editor.
 *
 * ADR-0004 puts the facts of the workspace in Zustand, and the look of the
 * editor is a fact of the workspace: a font size belongs to the window, not to
 * one file. The store keeps the slice that the editor and the status bar read,
 * and the slice persists, so a restart opens the editor the way the reader
 * left it.
 *
 * The settings that the shell owns are application settings, never secrets.
 * An API key belongs to the keychain behind its own session, and the store has
 * no field for one: the Rust side refuses a settings document that names a
 * secret, and `eslint.config.mjs` refuses a key inside the webview.
 */

/** The facts of the settings, without the actions that change them. */
export interface SettingsFacts {
  /** The size of the text of the editor, in pixels. */
  readonly fontSize: number;
  /** The number of spaces one tab holds. */
  readonly tabSize: number;
  /** True when a long line wraps instead of scrolling sideways. */
  readonly wordWrap: boolean;
  /** True when the editor shows the minimap beside the document. */
  readonly minimap: boolean;
  /** The family of the text of the editor. */
  readonly fontFamily: string;
}

/** The settings store of the shell. */
export interface SettingsState extends SettingsFacts {
  /** Set the size of the text of the editor. */
  readonly setFontSize: (size: number) => void;
  /** Set the number of spaces one tab holds. */
  readonly setTabSize: (size: number) => void;
  /** Turn the wrapping of long lines on or off. */
  readonly setWordWrap: (enabled: boolean) => void;
  /** Turn the minimap on or off. */
  readonly setMinimap: (enabled: boolean) => void;
  /** Set the family of the text of the editor. */
  readonly setFontFamily: (family: string) => void;
  /** Put every setting back the way a new window opens it. */
  readonly resetSettings: () => void;
}

/** The smallest size of the text of the editor. */
export const MIN_FONT_SIZE = 8;

/** The largest size of the text of the editor. */
export const MAX_FONT_SIZE = 32;

/** The smallest number of spaces one tab holds. */
export const MIN_TAB_SIZE = 1;

/** The largest number of spaces one tab holds. */
export const MAX_TAB_SIZE = 8;

/** The key the settings persist under. */
export const SETTINGS_STORAGE_KEY = "arrow.settings";

/** The settings the editor opens with. */
export const DEFAULT_SETTINGS: SettingsFacts = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  minimap: false,
  fontFamily: "JetBrains Mono",
};

/** Keep a number inside its bounds, and put a broken number back on the default. */
export function clampSetting(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

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
 * The storage of the settings.
 *
 * The look of the editor has to survive a restart, so the store writes through
 * this adapter on every change.
 */
export const settingsStorage: StateStorage = {
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

/**
 * The settings store of the shell.
 *
 * The editor pane and the status bar subscribe to one field each, so a change
 * of the font size repaints the editor and not the whole shell.
 */
export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], SettingsFacts>(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setFontSize: (size) =>
        set({
          fontSize: clampSetting(size, MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_SETTINGS.fontSize),
        }),
      setTabSize: (size) =>
        set({ tabSize: clampSetting(size, MIN_TAB_SIZE, MAX_TAB_SIZE, DEFAULT_SETTINGS.tabSize) }),
      setWordWrap: (enabled) => set({ wordWrap: enabled }),
      setMinimap: (enabled) => set({ minimap: enabled }),
      setFontFamily: (family) => set({ fontFamily: family.trim() || DEFAULT_SETTINGS.fontFamily }),
      resetSettings: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => settingsStorage),
      partialize: (state) => ({
        fontSize: state.fontSize,
        tabSize: state.tabSize,
        wordWrap: state.wordWrap,
        minimap: state.minimap,
        fontFamily: state.fontFamily,
      }),
    },
  ),
);

/** The settings as they persist, without the actions. */
export function settingsSnapshot(state: SettingsState): SettingsFacts {
  return {
    fontSize: state.fontSize,
    tabSize: state.tabSize,
    wordWrap: state.wordWrap,
    minimap: state.minimap,
    fontFamily: state.fontFamily,
  };
}

/**
 * Puts the settings back the way a new window opens them.
 *
 * The store is one mutable object, so every test of the store resets it first.
 * The reset clears the persisted document too, because a store that reads the
 * settings of another test is a test that only passes in one order.
 */
export function resetSettingsStore(): void {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
  settingsStorage.removeItem(SETTINGS_STORAGE_KEY);
}
