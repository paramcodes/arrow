import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { colorTokens, colors, tokenNames, tokenVariable } from "./index";
import { arrowPreset } from "./tailwind.preset";

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

const tokensCss = read("tokens.css");
const themeCss = read("theme.css");
const fontsCss = read("fonts.css");

describe("the design tokens", () => {
  it("names every token once", () => {
    expect(new Set(tokenNames).size).toBe(tokenNames.length);
  });

  it("reads a token through its CSS variable", () => {
    expect(tokenVariable("canvas")).toBe("var(--canvas)");
  });

  it("holds the same color in the stylesheet and in the constants", () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(tokensCss).toContain(`--${name}: ${value};`);
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
