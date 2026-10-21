/**
 * The keyboard shortcuts of the command registry.
 *
 * A command carries its shortcut as one string, such as `Mod+Shift+P`, and the
 * string is the only place the binding lives. The key handler of the shell and
 * the label of the palette read the same string, so a command cannot show one
 * binding and answer another.
 */

/** The parts of a shortcut that a keyboard event can match. */
export interface ShortcutParts {
  /** True when the shortcut needs the modifier of the platform. */
  readonly mod: boolean;
  /** True when the shortcut needs shift. */
  readonly shift: boolean;
  /** True when the shortcut needs alt. */
  readonly alt: boolean;
  /** The key, in lower case. */
  readonly key: string;
}

/** The parts of a keyboard event a shortcut reads. */
export interface ShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Parse a shortcut such as `Mod+Shift+P`. */
export function parseShortcut(shortcut: string): ShortcutParts {
  const parts = shortcut.split("+").map((part) => part.trim());
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());

  return {
    mod: modifiers.includes("mod"),
    shift: modifiers.includes("shift"),
    alt: modifiers.includes("alt"),
    key: key.toLowerCase(),
  };
}

/**
 * True when a keyboard event is the shortcut.
 *
 * `Mod` accepts both the command key of macOS and the control key of the other
 * platforms, because the same build runs on both and a shortcut that only
 * answers one of them is a shortcut half the readers cannot press.
 */
export function matchesShortcut(shortcut: string, event: ShortcutEvent): boolean {
  const parts = parseShortcut(shortcut);

  if (parts.mod !== (event.metaKey || event.ctrlKey)) return false;
  if (parts.shift !== event.shiftKey) return false;
  if (parts.alt !== event.altKey) return false;

  return event.key.toLowerCase() === parts.key;
}

/** True when the code runs on macOS. */
export function isMac(platform?: string): boolean {
  const value =
    platform ??
    (typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`);
  return /mac/i.test(value);
}

/** The label of a shortcut, as the palette shows it. */
export function formatShortcut(shortcut: string, platform?: string): string {
  const parts = parseShortcut(shortcut);
  const key = parts.key;

  if (isMac(platform)) {
    const glyph = key === "`" ? "`" : key.toUpperCase();
    return `${parts.mod ? "⌘" : ""}${parts.shift ? "⇧" : ""}${parts.alt ? "⌥" : ""}${glyph}`;
  }

  const pieces: string[] = [];
  if (parts.mod) pieces.push("Ctrl");
  if (parts.shift) pieces.push("Shift");
  if (parts.alt) pieces.push("Alt");
  pieces.push(key === "`" ? "`" : key.toUpperCase());

  return pieces.join("+");
}
