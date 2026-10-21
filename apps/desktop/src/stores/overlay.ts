import { create } from "zustand";

/**
 * The overlays of the shell.
 *
 * The command palette and the settings dialog float above the workspace, and
 * one fact decides which of them is open. The fact lives in Zustand with the
 * other facts of the workspace, so a command, a shortcut and a button all open
 * the same overlay through the same action.
 */

/** The list the command palette shows. */
export type PaletteMode = "commands" | "files";

/** The facts of the overlays. */
export interface OverlayFacts {
  /** The list the palette shows, or null when the palette is closed. */
  readonly palette: PaletteMode | null;
  /** True when the settings dialog is open. */
  readonly settingsOpen: boolean;
}

/** The overlay store of the shell. */
export interface OverlayState extends OverlayFacts {
  /** Open the palette on one of its lists. */
  readonly openPalette: (mode: PaletteMode) => void;
  /** Close the palette. */
  readonly closePalette: () => void;
  /** Open the settings dialog. */
  readonly openSettings: () => void;
  /** Close the settings dialog. */
  readonly closeSettings: () => void;
}

/** The facts the overlays hold when the window opens. */
const INITIAL_FACTS: OverlayFacts = { palette: null, settingsOpen: false };

/** The overlay store of the shell. */
export const useOverlayStore = create<OverlayState>()((set) => ({
  ...INITIAL_FACTS,
  openPalette: (mode) => set({ palette: mode, settingsOpen: false }),
  closePalette: () => set({ palette: null }),
  openSettings: () => set({ settingsOpen: true, palette: null }),
  closeSettings: () => set({ settingsOpen: false }),
}));

/** Put the overlays back the way a new window opens them. */
export function resetOverlayStore(): void {
  useOverlayStore.setState({ ...INITIAL_FACTS });
}
