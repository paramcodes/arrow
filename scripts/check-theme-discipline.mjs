#!/usr/bin/env node
/**
 * Fails when a component hardcodes a color instead of reading a token.
 *
 * The design tokens live in `packages/theme` as CSS custom properties. A hex
 * value or a color function in a component is a color the dark-first palette
 * does not control, so it is an error.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const scannedRoots = ["apps/desktop/src", "packages/ui/src", "packages/editor-core/src"];

const extensions = new Set([".ts", ".tsx", ".css"]);

const colorPatterns = [
  { name: "hex", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "function", pattern: /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\(/ },
];

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
    const content = readFileSync(file, "utf8");
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
