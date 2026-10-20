import { describe, expect, it } from "vitest";

import { cn } from "./index";

describe("the class name helper", () => {
  it("keeps the names that carry a value", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});
