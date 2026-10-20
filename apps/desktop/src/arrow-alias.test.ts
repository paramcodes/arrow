import { describe, expect, it } from "vitest";

import { cn } from "@arrow/ui";

/**
 * The app reaches the workspace packages through their `@arrow/*` alias, so a
 * broken alias has to fail here and not in the first session that imports a
 * package. The entry point of a package may be `index.ts` or `index.tsx`, and
 * the alias must resolve both.
 */
describe("the workspace package aliases", () => {
  it("resolves the ui package to its entry point", () => {
    expect(cn("a", false, "b")).toBe("a b");
  });
});
