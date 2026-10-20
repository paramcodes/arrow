import { describe, expect, it } from "vitest";

import { APP_NAME } from "./index";

describe("the shared contracts", () => {
  it("names the product Arrow", () => {
    expect(APP_NAME).toBe("Arrow");
  });
});
