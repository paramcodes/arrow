import { describe, expect, it } from "vitest";

import { countLines, createEmptyDocument } from "./index";

describe("the editor document model", () => {
  it("starts empty and clean", () => {
    const document = createEmptyDocument("/tmp/notes.md");

    expect(document.text).toBe("");
    expect(document.dirty).toBe(false);
    expect(document.languageId).toBe("plaintext");
  });

  it("counts the lines of a document", () => {
    const document = { ...createEmptyDocument("/tmp/a.ts"), text: "one\ntwo\n" };

    expect(countLines(document)).toBe(3);
  });
});
