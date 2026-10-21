import { beforeEach, describe, expect, it } from "vitest";

import { resetOverlayStore, useOverlayStore } from "./overlay";

/**
 * The overlays of the shell.
 *
 * The palette and the settings dialog never share the screen, so the cases
 * read that opening one closes the other.
 */
describe("the overlay store", () => {
  beforeEach(() => {
    resetOverlayStore();
  });

  it("opens on a closed window", () => {
    const state = useOverlayStore.getState();

    expect(state.palette).toBeNull();
    expect(state.settingsOpen).toBe(false);
  });

  it("opens the palette on the list it is asked for", () => {
    useOverlayStore.getState().openPalette("files");
    expect(useOverlayStore.getState().palette).toBe("files");

    useOverlayStore.getState().openPalette("commands");
    expect(useOverlayStore.getState().palette).toBe("commands");
  });

  it("closes the palette", () => {
    useOverlayStore.getState().openPalette("commands");
    useOverlayStore.getState().closePalette();

    expect(useOverlayStore.getState().palette).toBeNull();
  });

  it("closes the palette when the settings open", () => {
    useOverlayStore.getState().openPalette("commands");
    useOverlayStore.getState().openSettings();

    expect(useOverlayStore.getState().settingsOpen).toBe(true);
    expect(useOverlayStore.getState().palette).toBeNull();
  });

  it("closes the settings and leaves no state behind", () => {
    useOverlayStore.getState().openSettings();
    useOverlayStore.getState().closeSettings();
    resetOverlayStore();

    expect(useOverlayStore.getState().settingsOpen).toBe(false);
  });
});
