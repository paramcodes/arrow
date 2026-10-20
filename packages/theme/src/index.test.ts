import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { colorTokens, colors, focusTokens, tokenNames, tokenVariable } from "./index";
import { arrowPreset } from "./tailwind.preset";

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

const tokensCss = read("tokens.css");
const themeCss = read("theme.css");
const fontsCss = read("fonts.css");
const designMd = read("../../../DESIGN.md");

/**
 * A color value, split into the color space it names and the numbers it
 * carries. The spelling of a number is not part of a color, so the test
 * compares the numbers and not the text.
 */
function parseColor(value: string): { space: string; numbers: number[] } {
  const match = value.trim().match(/^([a-z-]+)\(([^)]*)\)$/);
  if (!match) throw new Error(`not a color function: ${value}`);
  const numbers = [...(match[2] ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((found) => Number(found[0]));
  return { space: match[1] ?? "", numbers };
}

/**
 * Asserts that two color values are the same color.
 */
function expectSameColor(actual: string, expected: string) {
  const left = parseColor(actual);
  const right = parseColor(expected);
  expect(left.space).toBe(right.space);
  expect(left.numbers.length).toBe(right.numbers.length);
  left.numbers.forEach((number, index) => {
    expect(number).toBeCloseTo(right.numbers[index] ?? Number.NaN, 10);
  });
}

/**
 * The value a token holds in the stylesheet.
 */
function stylesheetValue(name: string): string {
  const match = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`tokens.css does not define --${name}`);
  return match[1] ?? "";
}

/**
 * The value a token holds in the design document.
 */
function documentedValue(name: string): string {
  const line = designMd.split("\n").find((candidate) => candidate.includes(`\`--${name}\``));
  if (!line) throw new Error(`DESIGN.md does not document --${name}`);
  const match = line.match(/oklch\([^)]*\)/);
  if (!match) throw new Error(`DESIGN.md gives no value for --${name}`);
  return match[0];
}

describe("the design tokens", () => {
  it("names every token once", () => {
    expect(new Set(tokenNames).size).toBe(tokenNames.length);
  });

  it("reads a token through its CSS variable", () => {
    expect(tokenVariable("canvas")).toBe("var(--canvas)");
  });

  it("holds the same color in the stylesheet and in the constants", () => {
    for (const [name, value] of Object.entries(colors)) {
      expectSameColor(stylesheetValue(name), value);
    }
  });

  it("documents the same color as the stylesheet", () => {
    for (const name of [...colorTokens, ...focusTokens]) {
      expectSameColor(documentedValue(name), stylesheetValue(name));
    }
  });

  it("maps every color token into the Tailwind theme", () => {
    for (const name of colorTokens) {
      expect(themeCss).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it("maps every color token into the JavaScript preset", () => {
    for (const name of colorTokens) {
      expect(arrowPreset.theme.extend.colors[name]).toBe(`var(--${name})`);
    }
  });

  it("serves both families from the package", () => {
    expect(fontsCss).toContain('font-family: "Inter"');
    expect(fontsCss).toContain('font-family: "JetBrains Mono"');
  });

  it("points every font file at a file that exists", () => {
    const urls = [...fontsCss.matchAll(/url\("(\.\.\/fonts\/[^"]+)"\)/g)];
    expect(urls.length).toBeGreaterThan(0);
    for (const match of urls) {
      const target = match[1];
      expect(target).toBeDefined();
      if (!target) continue;
      expect(existsSync(fileURLToPath(new URL(target, import.meta.url)))).toBe(true);
    }
  });
});
