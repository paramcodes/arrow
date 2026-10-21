import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_AI_FACTS, DEFAULT_MODELS, resetAiStore, useAiStore } from "./ai";

/**
 * The AI store holds the facts of the AI feature.
 *
 * The store is one mutable object, so every test resets it before it runs. A
 * test that only passes because another test left the store in a particular
 * state is not a test: it fails the moment the order of the file changes.
 */
describe("the AI store", () => {
  beforeEach(() => {
    resetAiStore();
  });

  it("opens with the provider, the model, the flag and the boolean", () => {
    const state = useAiStore.getState();

    expect(state.provider).toBe("anthropic");
    expect(state.model).toBe(DEFAULT_MODELS.anthropic);
    expect(state.completionsEnabled).toBe(true);
    expect(state.hasKey).toBe(false);
  });

  it("holds the four facts and nothing else", () => {
    const state = useAiStore.getState();
    const facts = Object.keys(state).filter(
      (key) => typeof state[key as keyof typeof state] !== "function",
    );

    expect(facts.sort()).toEqual(["completionsEnabled", "hasKey", "model", "provider"]);
  });

  it("holds no key material", () => {
    const state = useAiStore.getState();
    const facts = Object.keys(state).filter(
      (key) => typeof state[key as keyof typeof state] !== "function",
    );
    const keys = facts.filter((key) => /key/i.test(key));

    expect(keys, "the store holds no key material").toEqual(["hasKey"]);
    expect(typeof state.hasKey).toBe("boolean");
  });

  it("changes the provider and the model that goes with it", () => {
    useAiStore.getState().setProvider("openai");

    const state = useAiStore.getState();
    expect(state.provider).toBe("openai");
    expect(state.model).toBe(DEFAULT_MODELS.openai);
  });

  it("changes the model", () => {
    useAiStore.getState().setModel("gpt-4o-mini");

    expect(useAiStore.getState().model).toBe("gpt-4o-mini");
  });

  it("keeps a model that is empty out of the store", () => {
    useAiStore.getState().setModel("   ");

    expect(useAiStore.getState().model).toBe(DEFAULT_MODELS.anthropic);
  });

  it("turns the completions on and off", () => {
    useAiStore.getState().setCompletionsEnabled(false);

    expect(useAiStore.getState().completionsEnabled).toBe(false);
  });

  it("says whether the provider has a key", () => {
    useAiStore.getState().setHasKey(true);

    expect(useAiStore.getState().hasKey).toBe(true);
  });

  it("leaves no state behind for the next test", () => {
    useAiStore.getState().setProvider("google");
    useAiStore.getState().setHasKey(true);

    resetAiStore();

    expect(useAiStore.getState()).toMatchObject(DEFAULT_AI_FACTS);
  });
});
