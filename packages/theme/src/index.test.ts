import { describe, expect, it } from "vitest";

import { tokenNames, tokenVariable } from "./index";

describe("the design tokens", () => {
  it("names every token once", () => {
    expect(new Set(tokenNames).size).toBe(tokenNames.length);
  });

  it("reads a token through its CSS variable", () => {
    expect(tokenVariable("canvas")).toBe("var(--canvas)");
  });
});
