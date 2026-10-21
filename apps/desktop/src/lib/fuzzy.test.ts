import { describe, expect, it } from "vitest";

import { filterByFuzzy, fuzzyScore, rankByFuzzy } from "./fuzzy";

/**
 * The fuzzy match of the palette.
 *
 * The cases read the behaviour the palette needs: a query matches letters that
 * are apart, a word start beats a letter in the middle of a word, and a query
 * that misses a letter matches nothing.
 */
describe("the fuzzy match", () => {
  it("matches letters that are apart", () => {
    const match = fuzzyScore("View: Toggle Sidebar", "tsb");

    expect(match).not.toBeNull();
    expect(match?.positions).toHaveLength(3);
  });

  it("matches an empty query everywhere", () => {
    expect(fuzzyScore("Anything", "")).toEqual({ score: 0, positions: [] });
  });

  it("misses a query whose letters are out of order", () => {
    expect(fuzzyScore("Toggle Sidebar", "bst")).toBeNull();
    expect(fuzzyScore("Toggle Sidebar", "tz")).toBeNull();
  });

  it("scores a word start above a letter in the middle of a word", () => {
    const start = fuzzyScore("View: Toggle Sidebar", "s");
    const middle = fuzzyScore("Paste", "s");

    expect(start?.score ?? 0).toBeGreaterThan(middle?.score ?? 0);
  });

  it("ranks the short label of a command above a long one", () => {
    const ranked = rankByFuzzy(
      ["Preferences: Open Settings", "Open Settings"],
      "settings",
      (text) => text,
    );

    expect(ranked[0]?.item).toBe("Open Settings");
  });

  it("keeps only the candidates that match", () => {
    const items = ["File: Save", "File: Save All", "View: Toggle Sidebar"];
    expect(filterByFuzzy(items, "save", (item) => item)).toEqual(["File: Save", "File: Save All"]);
  });

  it("orders a tie the same way on every run", () => {
    const items = ["beta", "alpha"];
    const first = rankByFuzzy(items, "", (item) => item).map((entry) => entry.item);
    const second = rankByFuzzy([...items].reverse(), "", (item) => item).map((entry) => entry.item);

    // A tie of the score falls back to the length of the text, so the shorter
    // label comes first no matter the order the candidates arrived in.
    expect(first).toEqual(["beta", "alpha"]);
    expect(second).toEqual(first);
  });
});
