import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The source of the settings of the AI. */
const aiSettingsSource = readFileSync(
  fileURLToPath(new URL("./AISettings.tsx", import.meta.url)),
  "utf8",
);

/** The source of the model picker. */
const modelSelectorSource = readFileSync(
  fileURLToPath(new URL("./ModelSelector.tsx", import.meta.url)),
  "utf8",
);

/**
 * The code of a source, without its comments.
 *
 * A comment names what the code does, so a source that only mentions a call in
 * a comment proves nothing. The assertions read the code alone: a call that is
 * gone fails the case, and a comment cannot keep it alive.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*[/]/g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * The settings of the AI, as they wire the key.
 *
 * The key belongs to the Rust shell and to the keychain of the operating
 * system, and the webview never keeps it. The settings therefore ask the shell
 * for the key, read the answer back into the store, and hold the key in one
 * field of the component. This case reads the source, because the wiring is
 * the thing that has to hold.
 */
describe("the settings of the AI", () => {
  it("asks the shell for the key and reads the answer back into the store", () => {
    const code = codeOf(aiSettingsSource);

    expect(code).toContain("setApiKey(");
    expect(code).toContain("hasApiKey(");
    expect(code).toContain("setHasKey(");
  });

  it("never keeps the key in a store", () => {
    expect(aiSettingsSource).not.toContain("useAiStore.setState");
    expect(aiSettingsSource).not.toContain("localStorage");
  });

  it("asks the shell for the key again when the provider changes", () => {
    const code = codeOf(aiSettingsSource);

    expect(code, "the refresh sits behind the provider it follows").toMatch(
      /\[\s*provider,\s*setHasKey\s*\]/,
    );
    expect(code, "the panel asks with the provider the reader chose").toContain(
      "hasApiKey(provider)",
    );
    expect(code, "the answer of the shell lands in the store").toContain("setHasKey(exists)");
  });

  it("offers the models of the provider", () => {
    expect(codeOf(modelSelectorSource)).toContain("PROVIDER_MODELS[provider]");
  });

  it("hands the model the reader picks to the store", () => {
    expect(codeOf(modelSelectorSource)).toContain("setModel(");
  });
});
