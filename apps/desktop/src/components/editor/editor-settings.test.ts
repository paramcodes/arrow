import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The source of the editor pane. */
const paneSource = readFileSync(
  fileURLToPath(new URL("./EditorPane.tsx", import.meta.url)),
  "utf8",
);

/**
 * The settings of the editor, as the pane wires them.
 *
 * A setting reaches the editor through an extension, and a setting that only
 * moves a number in the store is a control the reader turns with nothing
 * happening. The pane is therefore read as a source: it has to hand every
 * setting of the editor to the view.
 *
 * The behaviour is proved by the end to end case "Cmd+, opens the settings,
 * and the size and the wrapping apply live", which reads the computed size of
 * the text after the change. This case catches the edit that removes the
 * wiring before the suite ever runs.
 */
describe("the settings of the editor pane", () => {
  it("hands the size and the family of the text to a theme of the view", () => {
    expect(paneSource).toContain("View.theme(");
    expect(paneSource).toContain("fontSize: `${fontSize}px`");
    expect(paneSource).toContain("fontFamily");
  });

  it("names the editor element in the theme, so the base theme does not win", () => {
    expect(paneSource).toContain('"&.cm-editor"');
  });

  it("hands the wrapping of long lines to the view", () => {
    expect(paneSource).toContain("View.lineWrapping");
  });

  it("hands the width of a tab to the view", () => {
    expect(paneSource).toContain("EditorState.tabSize.of(tabSize)");
  });
});
