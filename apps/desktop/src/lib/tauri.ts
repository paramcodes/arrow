/**
 * The Tauri boundary of the frontend.
 *
 * The desktop app runs inside a Tauri webview. The same code also runs in a
 * plain browser, where no Tauri host exists. Every call goes through this
 * module, so a missing host never crashes the browser build.
 */

/** The arguments a Tauri command takes. */
export type CommandArgs = Record<string, unknown>;

/** True when the code runs inside a Tauri webview. */
export function isTauriHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Run a Rust command.
 *
 * Returns undefined when there is no Tauri host, which is the case in a plain
 * browser. The caller decides what an absent backend means.
 */
export async function invokeCommand<T>(
  command: string,
  args: CommandArgs = {},
): Promise<T | undefined> {
  if (!isTauriHost()) {
    return undefined;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
