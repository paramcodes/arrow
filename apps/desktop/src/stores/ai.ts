import { create } from "zustand";

import type { AiProvider } from "../lib/ai";

/**
 * The facts of the AI feature.
 *
 * ADR-0004 puts the facts of the workspace in Zustand, and the provider, the
 * model and the flag of the completions are facts of the window: they matter
 * to the whole shell and they change when a reader changes a setting, not on
 * every keystroke.
 *
 * The store holds four facts and nothing else. The key of a provider lives in
 * the keychain of the operating system and in Rust, so the store holds a
 * boolean that says whether a key exists and never the key itself: the shell
 * refuses a settings document that names a secret, and `eslint.config.mjs`
 * refuses a key inside the webview.
 */

/** The facts of the AI feature, without the actions that change them. */
export interface AiFacts {
  /** The provider the requests go to. */
  readonly provider: AiProvider;
  /** The model the requests go to. */
  readonly model: string;
  /** True when the shell asks for completions on its own. */
  readonly completionsEnabled: boolean;
  /** True when the provider has a key in the keychain of the operating system. */
  readonly hasKey: boolean;
}

/** The AI store of the shell. */
export interface AiState extends AiFacts {
  /** Choose the provider the requests go to. */
  readonly setProvider: (provider: AiProvider) => void;
  /** Choose the model the requests go to. */
  readonly setModel: (model: string) => void;
  /** Turn the completions on or off. */
  readonly setCompletionsEnabled: (enabled: boolean) => void;
  /** Say whether the provider has a key. */
  readonly setHasKey: (hasKey: boolean) => void;
}

/** The model each provider answers with by default. */
export const DEFAULT_MODELS: Readonly<Record<AiProvider, string>> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
};

/** The facts the store holds before the reader changes anything. */
export const DEFAULT_AI_FACTS: AiFacts = {
  provider: "anthropic",
  model: DEFAULT_MODELS.anthropic,
  completionsEnabled: true,
  hasKey: false,
};

/**
 * The AI store of the shell.
 *
 * The store does not persist. The key of a provider lives in the keychain of
 * the operating system, and a store that remembered whether a key exists
 * would be a store that lies after the reader removes the key in another
 * window.
 */
export const useAiStore = create<AiState>()((set) => ({
  ...DEFAULT_AI_FACTS,
  setProvider: (provider) => set({ provider, model: DEFAULT_MODELS[provider] }),
  setModel: (model) => set((state) => ({ model: model.trim() || DEFAULT_MODELS[state.provider] })),
  setCompletionsEnabled: (enabled) => set({ completionsEnabled: enabled }),
  setHasKey: (hasKey) => set({ hasKey }),
}));

/**
 * Puts the AI store back the way a new window opens it.
 *
 * The store is one mutable object, so every test resets it first, and the
 * reset puts the facts back, so a test that changes the provider does not
 * change the model of the test that runs after it.
 */
export function resetAiStore(): void {
  useAiStore.setState({ ...DEFAULT_AI_FACTS });
}
