import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * The Arrow dark theme for CodeMirror 6.
 *
 * Every color below is a CSS custom property of `packages/theme`. The editor
 * reads the same variables as the React tree and as xterm.js, so a change of
 * the palette changes the editor with it and no color literal lives in this
 * package.
 *
 * The theme covers the surfaces of the editor: the canvas of the document,
 * the gutter, the selection, the cursor, the active line, the bracket match
 * and the panels of the search. The syntax colors live in the highlight style
 * below, because a token color is a style of a tag and not a style of the
 * editor.
 */

/** The theme of the editor, as CodeMirror understands it. */
export const arrowDarkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--canvas)",
      color: "var(--ink)",
      fontFamily: "var(--font-mono)",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "8px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
      borderLeftWidth: "2px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--canvas)",
      color: "var(--ink-tertiary)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--canvas-soft)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--canvas-soft)",
      color: "var(--ink-secondary)",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--accent-soft)",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--accent-soft)",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--surface-hover)",
      color: "var(--ink)",
      outline: "1px solid var(--border-strong)",
    },
    ".cm-nonmatchingBracket": {
      color: "var(--error)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "var(--surface-hover)",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--accent-soft)",
      outline: "1px solid var(--border-strong)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--accent-soft)",
      outline: "1px solid var(--accent)",
    },
    ".cm-panels": {
      backgroundColor: "var(--surface)",
      color: "var(--ink)",
      border: "none",
    },
    ".cm-panels input, .cm-panels button": {
      backgroundColor: "var(--surface-hover)",
      color: "var(--ink)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-size-sm)",
    },
    ".cm-panels input:focus": {
      outline: "1px solid var(--accent)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--surface)",
      color: "var(--ink)",
      border: "1px solid var(--border-strong)",
      borderRadius: "var(--radius-size-sm)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--surface-hover)",
      color: "var(--ink)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--surface-hover)",
      color: "var(--ink-secondary)",
      border: "none",
      borderRadius: "var(--radius-size-sm)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 16px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0 4px",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
  },
  { dark: true },
);

/**
 * The colors of the syntax tokens.
 *
 * The tags are the ones the parsers of CodeMirror produce. A tag that is not
 * listed here keeps the color of the text, so an unknown token never paints
 * a color the palette does not hold.
 */
export const arrowHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--ink-tertiary)", fontStyle: "italic" },
  { tag: tags.lineComment, color: "var(--ink-tertiary)", fontStyle: "italic" },
  { tag: tags.blockComment, color: "var(--ink-tertiary)", fontStyle: "italic" },
  { tag: tags.docComment, color: "var(--ink-tertiary)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--accent)" },
  { tag: tags.controlKeyword, color: "var(--accent)" },
  { tag: tags.moduleKeyword, color: "var(--accent)" },
  { tag: tags.operatorKeyword, color: "var(--accent)" },
  { tag: tags.definitionKeyword, color: "var(--accent)" },
  { tag: tags.modifier, color: "var(--accent)" },
  { tag: tags.self, color: "var(--ink-secondary)" },
  { tag: tags.null, color: "var(--warning)" },
  { tag: tags.atom, color: "var(--info)" },
  { tag: tags.bool, color: "var(--info)" },
  { tag: tags.number, color: "var(--info)" },
  { tag: tags.integer, color: "var(--info)" },
  { tag: tags.float, color: "var(--info)" },
  { tag: tags.regexp, color: "var(--success)" },
  { tag: tags.string, color: "var(--success)" },
  { tag: tags.special(tags.string), color: "var(--success)" },
  { tag: tags.escape, color: "var(--warning)" },
  { tag: tags.function(tags.variableName), color: "var(--warning)" },
  { tag: tags.function(tags.propertyName), color: "var(--warning)" },
  { tag: tags.labelName, color: "var(--warning)" },
  { tag: tags.propertyName, color: "var(--ink-secondary)" },
  { tag: tags.definition(tags.variableName), color: "var(--ink)" },
  { tag: tags.variableName, color: "var(--ink)" },
  { tag: tags.typeName, color: "var(--info)" },
  { tag: tags.className, color: "var(--info)" },
  { tag: tags.namespace, color: "var(--ink-secondary)" },
  { tag: tags.macroName, color: "var(--warning)" },
  { tag: tags.literal, color: "var(--info)" },
  { tag: tags.operator, color: "var(--ink-secondary)" },
  { tag: tags.derefOperator, color: "var(--ink-secondary)" },
  { tag: tags.arithmeticOperator, color: "var(--ink-secondary)" },
  { tag: tags.logicOperator, color: "var(--ink-secondary)" },
  { tag: tags.bracket, color: "var(--ink-secondary)" },
  { tag: tags.punctuation, color: "var(--ink-secondary)" },
  { tag: tags.separator, color: "var(--ink-tertiary)" },
  { tag: tags.contentSeparator, color: "var(--ink-tertiary)" },
  { tag: tags.meta, color: "var(--ink-tertiary)" },
  { tag: tags.processingInstruction, color: "var(--ink-tertiary)" },
  { tag: tags.heading, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.heading1, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.heading2, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.heading3, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.heading4, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.heading5, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.heading6, color: "var(--accent)", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--info)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--info)" },
  { tag: tags.quote, color: "var(--ink-secondary)", fontStyle: "italic" },
  { tag: tags.monospace, color: "var(--success)" },
  { tag: tags.list, color: "var(--accent)" },
  { tag: tags.tagName, color: "var(--accent)" },
  { tag: tags.attributeName, color: "var(--warning)" },
  { tag: tags.attributeValue, color: "var(--success)" },
  { tag: tags.inserted, color: "var(--success)" },
  { tag: tags.deleted, color: "var(--error)" },
  { tag: tags.invalid, color: "var(--error)" },
]);
