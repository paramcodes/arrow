#!/usr/bin/env node
/**
 * Fails when a component hardcodes a color instead of reading a token.
 *
 * The design tokens live in `packages/theme` as CSS custom properties. A hex
 * value, a color function, a named color, a bare channel triplet or a
 * Tailwind default-palette utility in a component is a color the dark-first
 * palette does not control, so it is an error.
 *
 * The check reads the whole repository rather than a list of directories, so
 * a new package or a new stylesheet is scanned the day it lands. Only the
 * token package is exempt, because that is the one place a color literal
 * belongs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The directories that never carry paint: dependencies, build output and
 * tool caches. A dot directory is skipped as well, so a worktree or a cache
 * inside the tree never reaches the check.
 */
const skippedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "playwright-report",
  "test-results",
  "gen",
]);

/**
 * The package that holds the tokens. It is the one place in the repository
 * where a color literal may live, so it is exempt from the scan.
 */
const tokenHomes = ["packages/theme"];

/**
 * The files the check skips by path. The checker holds the table of the
 * named colors, and a detection table is not paint.
 */
const skippedFiles = ["scripts/check-theme-discipline.mjs"];

/**
 * Every extension that can carry a style. A `.vue` or a `.svelte` file is a
 * component, and a component can paint.
 */
const extensions = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".ts",
  ".tsx",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".vue",
  ".svelte",
]);

/**
 * The CSS named colors. A keyword such as `red` is a color too, and it is the
 * form a hardcoded color takes most often by accident.
 *
 * `transparent` and `currentcolor` are not in the list. They are keywords that
 * ask for the absence of a color, not a color of the palette.
 */
const namedColors = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

/**
 * The color functions of CSS.
 *
 * `rgb` and `hsl` are the old ones. The modern set adds `oklch`, `oklab`,
 * `lab`, `lch` and `hwb`, and `color` covers every space of the CSS Color 4
 * syntax, such as `color(display-p3 1 0 0)`.
 */
const colorFunctions = [
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "oklch",
  "oklab",
  "lab",
  "lch",
  "hwb",
  "color",
  "color-mix",
  "light-dark",
  "device-cmyk",
];

/**
 * The default palette of Tailwind. A utility such as `bg-red-500` paints a
 * color the dark-first palette does not control, so it is an error.
 */
const tailwindPalette = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "white",
  "black",
];

/**
 * The utility prefixes that carry a color.
 */
const colorUtilityPrefixes = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "decoration",
  "shadow",
  "divide",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "caret",
  "accent",
  "placeholder",
];

/**
 * The shades of the Tailwind palette. A utility without a shade is legal
 * too, so the shade is optional.
 */
const tailwindShades = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

const colorPatterns = [
  { name: "hex", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "function", pattern: new RegExp(`\\b(?:${colorFunctions.join("|")})\\(`, "i") },
  {
    name: "named",
    // A named color must stand alone. `red` is a color, `bordered` and
    // `--red` are identifiers.
    pattern: new RegExp(`(?<![-\\w.$])(?:${namedColors.join("|")})(?![-\\w-])`, "i"),
  },
  {
    name: "tailwind-utility",
    // `bg-red-500`, `text-blue-600`, `border-green-500` and their kin. The
    // prefix is a utility that carries a color, the name is a default
    // palette name, and the shade is optional.
    pattern: new RegExp(
      `(?<![-\\w])(?:${colorUtilityPrefixes.join("|")})` +
        `(?:-(?:t|r|b|l|x|y|s|e|ss|offset))?` +
        `-(?:${tailwindPalette.join("|")})` +
        `(?:-(?:${tailwindShades.join("|")}))?` +
        `(?:/\\d{1,3})?(?![-\\w])`,
    ),
  },
];

/**
 * A custom property and its value. A custom property is the one place a
 * bare channel triplet is legal CSS, so it is the one place the triplet
 * check looks.
 */
const customProperty = /--[\w-]+\s*:\s*([^;]+)/g;

/**
 * A quoted string. A string that holds nothing but a channel triplet is a
 * color written in a script, and a script cannot use a token on its own.
 */
const quotedString = /(["'`])((?:(?!\1).)*)\1/g;

/**
 * A number of a channel triplet, with an optional percent.
 */
const channelNumber = /^\d+(?:\.\d+)?%?$/;

/**
 * Splits a value into the numbers of a channel triplet, or returns null when
 * the value is not a run of numbers. An alpha channel at the end is dropped.
 */
function channelParts(value) {
  const withoutAlpha = value
    .trim()
    .replace(/\/\s*[\d.]+%?$/, "")
    .trim();
  const parts = withoutAlpha.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.every((part) => channelNumber.test(part))) return null;
  return parts;
}

/**
 * Tells whether a value is a bare channel triplet, such as
 * `222.2 47.4% 11.2%` or `0 0% 100%`.
 *
 * A triplet that carries a percent is a color anywhere it appears.
 */
function isColorChannelTriplet(value) {
  const parts = channelParts(value);
  if (!parts) return false;
  return parts.some((part) => part.endsWith("%"));
}

/**
 * Tells whether the value of a custom property holds a channel triplet.
 *
 * A custom property may hold plain numbers, and that is the convention a
 * component library uses to define its own palette, so a triplet of plain
 * numbers counts here. A triplet of plain numbers is also a valid CSS length
 * list, which is why it counts nowhere else.
 */
function isBareChannelTriplet(value) {
  return channelParts(value) !== null;
}

/**
 * Removes the comments of a source file.
 *
 * A color named in a comment paints nothing, so it must not fail the check.
 */
function stripComments(content, extension) {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (extension === ".html" || extension === ".vue" || extension === ".svelte") {
    return withoutBlocks.replace(/<!--[\s\S]*?-->/g, " ");
  }
  if (
    extension === ".css" ||
    extension === ".scss" ||
    extension === ".sass" ||
    extension === ".less"
  ) {
    if (extension === ".css") return withoutBlocks;
    return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }
  return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Collects every file of the repository that can carry a style.
 */
function walk(directory, relative) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(directory, entry);
    const relativePath = relative ? path.join(relative, entry) : entry;
    if (skippedFiles.includes(relativePath)) continue;
    if (statSync(full).isDirectory()) {
      if (skippedDirectories.has(entry)) continue;
      if (tokenHomes.includes(relativePath)) continue;
      found.push(...walk(full, relativePath));
    } else if (extensions.has(path.extname(full))) {
      found.push({ file: full, relative: relativePath });
    }
  }
  return found;
}

const offenses = [];
let scanned = 0;

for (const { file, relative } of walk(root, "")) {
  scanned += 1;
  const content = stripComments(readFileSync(file, "utf8"), path.extname(file));
  content.split("\n").forEach((line, index) => {
    const report = (name, text) => {
      offenses.push(`${relative}:${index + 1} hardcoded color (${name}): ${text.trim()}`);
    };

    for (const { name, pattern } of colorPatterns) {
      if (pattern.test(line)) report(name, line);
    }

    customProperty.lastIndex = 0;
    for (const match of line.matchAll(customProperty)) {
      if (isBareChannelTriplet(match[1] ?? "")) report("channel-triplet", match[0]);
    }

    quotedString.lastIndex = 0;
    for (const match of line.matchAll(quotedString)) {
      if (isColorChannelTriplet(match[2] ?? "")) report("channel-triplet", match[0]);
    }
  });
}

if (offenses.length > 0) {
  console.error("hardcoded color found. Read a token from packages/theme instead:");
  for (const offense of offenses) {
    console.error(`  ${offense}`);
  }
  process.exit(1);
}

console.log(`no-hardcoded-colors: ${scanned} files scanned, no hardcoded color found`);
