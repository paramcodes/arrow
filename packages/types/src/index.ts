/**
 * The shared type contracts of Arrow.
 *
 * Every workspace imports these instead of repeating a shape, so the desktop
 * app and the packages cannot drift apart.
 */

/** The product name. The window title, the bundle name and the about box use it. */
export const APP_NAME = "Arrow";

/** The facts about the running application. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly tauri: boolean;
}

/** The theme tiers Arrow ships. Dark is the first tier, not an afterthought. */
export type ThemeTier = "dark" | "light";

/** One entry of a directory, as the shell reads it from the disk. */
export interface FileEntry {
  /** The file name of the entry, without its directory. */
  readonly name: string;
  /** The path of the entry. */
  readonly path: string;
  /** True when the entry is a directory. */
  readonly isDirectory: boolean;
}
