import { useEffect, useState, type JSX } from "react";

import { Button } from "@arrow/ui";

import { hasApiKey, setApiKey, type AiProvider } from "../../lib/ai";
import { useAiStore } from "../../stores/ai";
import { ModelSelector } from "./ModelSelector";

/** The providers the settings offer, in the order the toggle shows them. */
const PROVIDERS: readonly { readonly id: AiProvider; readonly label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
];

/**
 * The settings of the AI feature.
 *
 * The provider, the model and the flag of the completions are facts of the
 * window, so they live in the store and the shell reads them from there.
 *
 * The key of a provider is not a fact of the window. The reader types it, it
 * goes straight to the shell, and the shell puts it in the keychain of the
 * operating system. The webview holds the key in one field of this component
 * and in nothing else: the shell answers whether a key exists, and that
 * answer is what the store carries.
 */
export function AISettings(): JSX.Element {
  const provider = useAiStore((state) => state.provider);
  const hasKey = useAiStore((state) => state.hasKey);
  const completionsEnabled = useAiStore((state) => state.completionsEnabled);
  const setProvider = useAiStore((state) => state.setProvider);
  const setHasKey = useAiStore((state) => state.setHasKey);
  const setCompletionsEnabled = useAiStore((state) => state.setCompletionsEnabled);
  const [key, setKey] = useState("");

  // A change of the provider changes the answer of the keychain, so the
  // panel asks the shell for the key of the provider it now shows, the way
  // the status bar does. The answer is a boolean and never the key itself.
  useEffect(() => {
    let cancelled = false;

    void hasApiKey(provider).then((exists) => {
      if (cancelled) return;
      setHasKey(exists);
    });

    return () => {
      cancelled = true;
    };
  }, [provider, setHasKey]);

  async function saveKey(): Promise<void> {
    if (key.length === 0) return;
    await setApiKey(provider, key);
    const exists = await hasApiKey(provider);
    setHasKey(exists);
    setKey("");
  }

  return (
    <section className="flex flex-col gap-3" data-testid="settings-ai">
      <h3 className="text-xs font-medium text-ink">AI</h3>

      <div aria-label="Provider" className="flex items-center gap-1" role="group">
        {PROVIDERS.map((entry) => {
          const pressed = entry.id === provider;
          return (
            <Button
              aria-pressed={pressed}
              className={pressed ? "bg-surface-hover text-ink" : "text-ink-secondary"}
              data-testid={`ai-provider-${entry.id}`}
              key={entry.id}
              onClick={() => setProvider(entry.id)}
              size="sm"
              variant="outline"
            >
              {entry.label}
            </Button>
          );
        })}
      </div>

      <ModelSelector />

      <div className="flex flex-col gap-1">
        <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
          <span>API key</span>
          <input
            autoComplete="off"
            className="h-7 w-48 rounded-sm border border-border bg-canvas px-2 text-xs text-ink outline-none focus:border-accent"
            data-testid="ai-api-key"
            onChange={(event) => setKey(event.target.value)}
            spellCheck={false}
            type="password"
            value={key}
          />
        </label>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-ink-secondary" data-testid="ai-key-status">
            {hasKey
              ? "A key is in the keychain of the operating system."
              : "No key for this provider yet."}
          </p>
          <Button data-testid="ai-api-key-save" onClick={() => void saveKey()} size="sm">
            Save key
          </Button>
        </div>
      </div>

      <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
        <span>Suggest completions</span>
        <input
          checked={completionsEnabled}
          className="h-3.5 w-3.5 [accent-color:var(--accent)]"
          data-testid="ai-completions"
          onChange={(event) => setCompletionsEnabled(event.target.checked)}
          type="checkbox"
        />
      </label>
    </section>
  );
}
