import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  MAX_FONT_SIZE,
  MAX_TAB_SIZE,
  MIN_FONT_SIZE,
  MIN_TAB_SIZE,
  SETTINGS_STORAGE_KEY,
  resetSettingsStore,
  settingsStorage,
  useSettingsStore,
} from "./settings";

/** The directory the store tests live in. */
const storesDirectory = fileURLToPath(new URL(".", import.meta.url));

/**
 * The settings store.
 *
 * The store holds the look of the editor. The cases read the defaults, the
 * bounds of a setting and the document the store writes, because a setting
 * that does not survive a restart is a setting the reader sets twice.
 */
describe("the settings store", () => {
  beforeEach(() => {
    resetSettingsStore();
  });

  afterEach(() => {
    resetSettingsStore();
  });

  it("opens with the defaults of the editor", () => {
    const state = useSettingsStore.getState();

    expect(state.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(state.tabSize).toBe(DEFAULT_SETTINGS.tabSize);
    expect(state.wordWrap).toBe(DEFAULT_SETTINGS.wordWrap);
    expect(state.minimap).toBe(DEFAULT_SETTINGS.minimap);
    expect(state.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
  });

  it("keeps the size of the text inside its bounds", () => {
    useSettingsStore.getState().setFontSize(MIN_FONT_SIZE - 4);
    expect(useSettingsStore.getState().fontSize).toBe(MIN_FONT_SIZE);

    useSettingsStore.getState().setFontSize(MAX_FONT_SIZE + 4);
    expect(useSettingsStore.getState().fontSize).toBe(MAX_FONT_SIZE);

    useSettingsStore.getState().setFontSize(18.4);
    expect(useSettingsStore.getState().fontSize).toBe(18);
  });

  it("keeps a broken size on the default", () => {
    useSettingsStore.getState().setFontSize(Number.NaN);
    expect(useSettingsStore.getState().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it("keeps the width of a tab inside its bounds", () => {
    useSettingsStore.getState().setTabSize(MIN_TAB_SIZE - 2);
    expect(useSettingsStore.getState().tabSize).toBe(MIN_TAB_SIZE);

    useSettingsStore.getState().setTabSize(MAX_TAB_SIZE + 2);
    expect(useSettingsStore.getState().tabSize).toBe(MAX_TAB_SIZE);
  });

  it("falls back to the default family when the family is empty", () => {
    useSettingsStore.getState().setFontFamily("   ");
    expect(useSettingsStore.getState().fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
  });

  it("turns the wrapping and the minimap on", () => {
    useSettingsStore.getState().setWordWrap(true);
    useSettingsStore.getState().setMinimap(true);

    expect(useSettingsStore.getState().wordWrap).toBe(true);
    expect(useSettingsStore.getState().minimap).toBe(true);
  });

  it("writes its change into the persisted document", () => {
    expect(useSettingsStore.persist.getOptions().name).toBe(SETTINGS_STORAGE_KEY);

    useSettingsStore.getState().setFontSize(20);

    const document = settingsStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(document).not.toBeNull();
    expect(document).toContain('"fontSize":20');
    expect(document).not.toContain("setFontSize");
  });

  it("reads the settings a previous session left behind", async () => {
    settingsStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { ...DEFAULT_SETTINGS, fontSize: 22 }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().fontSize).toBe(22);
  });

  it("puts every setting back on the defaults", () => {
    useSettingsStore.getState().setFontSize(24);
    useSettingsStore.getState().setWordWrap(true);

    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(useSettingsStore.getState().wordWrap).toBe(false);
  });

  it("leaves no state behind for the next test", () => {
    useSettingsStore.getState().setFontSize(24);
    resetSettingsStore();

    expect(useSettingsStore.getState().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settingsStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("resets the store before every test of the store", () => {
    const files = readdirSync(storesDirectory).filter((name) => name.endsWith(".test.ts"));

    expect(files.length).toBeGreaterThan(0);

    for (const name of files) {
      const source = readFileSync(`${storesDirectory}${name}`, "utf8");
      const store = name.replace(/\.test\.ts$/, "");
      const reset = `reset${store.charAt(0).toUpperCase()}${store.slice(1)}Store(`;

      expect(source, `${name} has no beforeEach hook`).toContain("beforeEach");
      expect(source, `${name} does not reset the store`).toContain(reset);
    }
  });
});
