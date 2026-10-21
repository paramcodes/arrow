import { describe, expect, it } from "vitest";

import { formatShortcut, matchesShortcut, parseShortcut } from "./shortcuts";

/** A keyboard event, as the key handler reads it. */
function key(
  value: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) {
  return {
    key: value,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  };
}

/**
 * The shortcuts of the commands.
 *
 * A shortcut is one string that the palette shows and the key handler answers.
 * The cases read both sides of that promise.
 */
describe("the shortcuts of the commands", () => {
  it("parses a shortcut into its parts", () => {
    expect(parseShortcut("Mod+Shift+P")).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: "p",
    });
  });

  it("matches the control key and the command key alike", () => {
    expect(matchesShortcut("Mod+P", key("p", { ctrl: true }))).toBe(true);
    expect(matchesShortcut("Mod+P", key("p", { meta: true }))).toBe(true);
  });

  it("refuses a shortcut that misses a modifier", () => {
    expect(matchesShortcut("Mod+P", key("p"))).toBe(false);
    expect(matchesShortcut("Mod+Shift+P", key("p", { ctrl: true }))).toBe(false);
  });

  it("holds shift apart from the shortcut without it", () => {
    expect(matchesShortcut("Mod+P", key("p", { ctrl: true, shift: true }))).toBe(false);
    expect(matchesShortcut("Mod+Shift+P", key("p", { ctrl: true, shift: true }))).toBe(true);
  });

  it("matches the key without its case", () => {
    expect(matchesShortcut("Mod+B", key("B", { ctrl: true }))).toBe(true);
  });

  it("matches the backquote of the terminal shortcut", () => {
    expect(matchesShortcut("Mod+`", key("`", { ctrl: true }))).toBe(true);
  });

  it("shows the control spelling off macOS and the glyphs on it", () => {
    expect(formatShortcut("Mod+Shift+P", "Linux x86_64")).toBe("Ctrl+Shift+P");
    expect(formatShortcut("Mod+Shift+P", "MacIntel")).toBe("⌘⇧P");
  });
});
