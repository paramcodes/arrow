import { describe, expect, it } from "vitest";

import { isTauriHost } from "./tauri";

describe("the Tauri boundary", () => {
  it("reports that a plain browser has no Tauri host", () => {
    expect(isTauriHost()).toBe(false);
  });
});
