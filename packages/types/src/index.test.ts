import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_NAME } from "./index";

/**
 * The shared contracts of Arrow.
 *
 * The types are erased at run time, so a contract that no longer matches the
 * boundary it describes cannot fail a type test. The case below reads the
 * source of the module instead: `CommandResult<T>` promised a result that the
 * live boundary in `apps/desktop/src/lib/tauri.ts` never returned, and a type
 * that lies about its boundary is worse than no type at all.
 */
describe("the shared contracts", () => {
  it("names the product Arrow", () => {
    expect(APP_NAME).toBe("Arrow");
  });

  it("does not carry a result type the boundary never returns", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

    expect(source).not.toContain("CommandResult");
  });
});
