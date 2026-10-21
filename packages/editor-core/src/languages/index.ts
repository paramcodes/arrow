import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import type { LanguageSupport } from "@codemirror/language";

/**
 * The language registry of Arrow.
 *
 * A document names its language, and the registry turns that name into the
 * parser of CodeMirror. A language that the registry does not know is plain
 * text, and the editor still opens it.
 */

/** The languages Arrow ships a parser for. */
export const supportedLanguages = {
  javascript: javascript(),
  typescript: javascript({ typescript: true }),
  jsx: javascript({ jsx: true }),
  tsx: javascript({ jsx: true, typescript: true }),
  python: python(),
  rust: rust(),
  json: json(),
  markdown: markdown(),
  html: html(),
  css: css(),
} satisfies Record<string, LanguageSupport>;

/** The name of every language the registry holds. */
export const supportedLanguageIds = Object.keys(supportedLanguages);

/** The language Arrow opens a document in when it does not know its extension. */
export const PLAIN_TEXT_LANGUAGE = "plaintext";

/**
 * The language of a file extension.
 *
 * The mapping is the only place that knows which extension opens in which
 * language. An extension that is missing here is not guessed: the document
 * opens as plain text, so a file Arrow cannot parse never opens in a parser of
 * another language.
 */
const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  pyw: "python",
  rs: "rust",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
};

/**
 * The language of a path, read from the extension of its file name.
 *
 * A name without an extension, a dotfile such as `.gitignore` and an
 * extension the registry does not know are all plain text.
 */
export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return PLAIN_TEXT_LANGUAGE;

  const extension = name.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGES[extension] ?? PLAIN_TEXT_LANGUAGE;
}

/**
 * The parser of a language, or undefined when the registry does not know it.
 *
 * A document without a parser is plain text. The editor opens it anyway.
 */
export function languageFor(languageId: string): LanguageSupport | undefined {
  return supportedLanguages[languageId as keyof typeof supportedLanguages];
}
