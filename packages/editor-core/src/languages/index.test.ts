import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { languageFor, supportedLanguageIds, supportedLanguages } from "./index";

/**
 * The language registry of Arrow.
 *
 * A document names its language, and the registry turns that name into the
 * parser of CodeMirror. The registry is the only place that knows which
 * languages Arrow ships, so a language that is missing here is a language
 * that opens as plain text.
 */

/** The names of every node of a parsed document. */
function nodeNames(languageId: string, doc: string): Set<string> {
  const support = languageFor(languageId);
  if (!support) throw new Error(`${languageId} has no parser`);

  const state = EditorState.create({ doc, extensions: [support] });
  const tree = ensureSyntaxTree(state, doc.length, 5_000);
  if (!tree) throw new Error(`${languageId} did not parse`);

  const names = new Set<string>();
  const cursor = tree.cursor();
  do {
    names.add(cursor.name);
  } while (cursor.next());

  return names;
}

describe("the language registry", () => {
  it("holds a parser for every language Arrow ships", () => {
    expect(supportedLanguageIds).toEqual([
      "javascript",
      "typescript",
      "jsx",
      "tsx",
      "python",
      "rust",
      "json",
      "markdown",
      "html",
      "css",
    ]);
  });

  it("returns no parser for a language it does not know", () => {
    expect(languageFor("plaintext")).toBeUndefined();
    expect(languageFor("brainfuck")).toBeUndefined();
  });

  it("parses JavaScript and TypeScript", () => {
    expect(nodeNames("javascript", "const answer = 42;\n")).toContain("VariableDeclaration");
    expect(nodeNames("typescript", "interface A { b: string }\n")).toContain(
      "InterfaceDeclaration",
    );
  });

  it("parses Python and Rust", () => {
    expect(nodeNames("python", "def main():\n    return 1\n")).toContain("FunctionDefinition");
    expect(nodeNames("rust", "fn main() { let x = 1; }\n")).toContain("FunctionItem");
  });

  it("parses JSON and Markdown", () => {
    expect(nodeNames("json", '{"a": [1, 2]}\n')).toContain("Property");
    expect(nodeNames("markdown", "# Title\n\nSome *text*.\n")).toContain("ATXHeading1");
  });

  it("keeps one parser per language, so a reconfiguration reuses it", () => {
    expect(languageFor("typescript")).toBe(supportedLanguages.typescript);
    expect(languageFor("rust")).toBe(supportedLanguages.rust);
  });
});
