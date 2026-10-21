/**
 * The names the status bar shows for a language.
 *
 * The editor registry names a language after its extension, and the status bar
 * shows the product name of it. The table lives here so the status bar never
 * prints the identifier of a parser.
 */

/** The label of every language the registry knows. */
const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JavaScript React",
  tsx: "TypeScript React",
  python: "Python",
  rust: "Rust",
  json: "JSON",
  markdown: "Markdown",
  html: "HTML",
  css: "CSS",
  plaintext: "Plain Text",
};

/** The label of a language, or the identifier itself when the table is short. */
export function languageLabel(languageId: string): string {
  return LANGUAGE_LABELS[languageId] ?? languageId;
}
