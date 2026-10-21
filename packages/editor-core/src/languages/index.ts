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

/**
 * The parser of a language, or undefined when the registry does not know it.
 *
 * A document without a parser is plain text. The editor opens it anyway.
 */
export function languageFor(languageId: string): LanguageSupport | undefined {
  return supportedLanguages[languageId as keyof typeof supportedLanguages];
}
