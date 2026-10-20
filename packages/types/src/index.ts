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

/** The result of a command that crossed the Tauri boundary. */
export type CommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };
