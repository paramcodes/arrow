import type { JSX } from "react";

import { PROVIDER_MODELS, useAiStore } from "../../stores/ai";

/**
 * The model picker of the settings.
 *
 * The models belong to the provider, so the list follows the provider the
 * reader chose, and the choice goes into the store, which the shell reads
 * when it asks for a completion.
 */
export function ModelSelector(): JSX.Element {
  const provider = useAiStore((state) => state.provider);
  const model = useAiStore((state) => state.model);
  const setModel = useAiStore((state) => state.setModel);

  return (
    <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
      <span>Model</span>
      <select
        className="h-7 w-48 rounded-sm border border-border bg-canvas px-2 text-xs text-ink outline-none focus:border-accent"
        data-testid="ai-model"
        onChange={(event) => setModel(event.target.value)}
        value={model}
      >
        {PROVIDER_MODELS[provider].map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
