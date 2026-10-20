#!/usr/bin/env node
/**
 * Fails when a component hardcodes a color instead of reading a token.
 *
 * The design tokens live in `packages/theme` as CSS custom properties. A hex
 * value, a color function or a named color in a component is a color the
 * dark-first palette does not control, so it is an error.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const scannedRoots = ["apps/desktop/src", "packages/ui/src", "packages/editor-core/src"];

const extensions = new Set([".ts", ".tsx", ".css"]);

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

const colorPatterns = [
  { name: "hex", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "function", pattern: /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\(/ },
  {
    name: "named",
    // A named color must stand alone. `red` is a color, `bordered` and
    // `--red` are identifiers.
    pattern: new RegExp(`(?<![-\\w.$])(?:${namedColors.join("|")})(?![-\\w-])`, "i"),
  },
];

/**
 * Removes the comments of a source file.
 *
 * A color named in a comment paints nothing, so it must not fail the check.
 */
function stripComments(content, extension) {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (extension !== ".css") {
    return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }
  return withoutBlocks;
}

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (extensions.has(path.extname(full))) {
      found.push(full);
    }
  }
  return found;
}

const offenses = [];
let scanned = 0;

for (const scannedRoot of scannedRoots) {
  const absolute = path.join(root, scannedRoot);
  let files = [];
  try {
    files = walk(absolute);
  } catch {
    continue;
  }

  for (const file of files) {
    scanned += 1;
    const content = stripComments(readFileSync(file, "utf8"), path.extname(file));
    content.split("\n").forEach((line, index) => {
      for (const { name, pattern } of colorPatterns) {
        if (pattern.test(line)) {
          offenses.push(
            `${path.relative(root, file)}:${index + 1} hardcoded color (${name}): ${line.trim()}`,
          );
        }
      }
    });
  }
}

if (offenses.length > 0) {
  console.error("hardcoded color found. Read a token from packages/theme instead:");
  for (const offense of offenses) {
    console.error(`  ${offense}`);
  }
  process.exit(1);
}

console.log(`no-hardcoded-colors: ${scanned} files scanned, no hardcoded color found`);
