/**
 * The AI boundary of the frontend.
 *
 * The webview asks the Rust shell for a completion or for an inline edit, and
 * the shell answers with events: `ai:token:{request_id}` for every token,
 * `ai:complete:{request_id}` when the stream ends and `ai:error:{request_id}`
 * when it fails. Escape ends a request through one command path, and that
 * path serves the ghost text and the inline edit alike.
 *
 * The key of a provider never crosses this module. The shell keeps it in the
 * keychain of the operating system, `get_api_key` answers whether a key
 * exists, and the answer is a boolean. The key that a reader types goes
 * straight to the shell and is not kept here, not logged and not stored.
 *
 * The desktop app runs inside a Tauri webview. The same code also runs in a
 * plain browser, where no Tauri host exists, so the stub below answers every
 * call and replays a canned token stream. The stub never opens a network
 * connection and never keeps a key.
 */

import { invokeCommand, isTauriHost, type UnlistenFn } from "./tauri";

/** The providers the feature knows. */
export type AiProvider = "anthropic" | "openai" | "google";

/** A request for a completion. */
export interface CompletionRequest {
  /** The id of the request. The shell uses it to name the events. */
  readonly requestId: string;
  /** The provider the request goes to. */
  readonly provider: AiProvider;
  /** The model the request goes to. */
  readonly model: string;
  /** The prompt of the request. */
  readonly prompt: string;
  /** The context of the request: the file, the caret and the selection. */
  readonly context: string;
}

/** A request for an inline edit. */
export interface InlineEditRequest {
  /** The id of the request. The shell uses it to name the events. */
  readonly requestId: string;
  /** The provider the request goes to. */
  readonly provider: AiProvider;
  /** The model the request goes to. */
  readonly model: string;
  /** The instruction of the edit. */
  readonly instruction: string;
  /** The text the edit applies to. */
  readonly selection: string;
}

/** The payload of `ai:token:{request_id}`. */
export interface AiTokenPayload {
  /** The text of the token. */
  readonly token: string;
  /** False while the stream is running. */
  readonly done: boolean;
}

/** The payload of `ai:complete:{request_id}`. */
export interface AiCompletePayload {
  /** True when the stream ended. */
  readonly done: boolean;
}

/** The payload of `ai:error:{request_id}`. */
export interface AiErrorPayload {
  /** The message of the failure. It never carries a key. */
  readonly error: string;
}

/** The commands the frontend sends to the shell. */
export type AiCommand =
  | "complete"
  | "inline_edit"
  | "cancel_request"
  | "set_api_key"
  | "get_api_key"
  | "delete_api_key";

/** One command the boundary sent, for the end to end suite. */
export interface AiCall {
  /** The name of the command. */
  readonly command: AiCommand;
  /** The arguments of the command. A key never appears in them. */
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * The text that stands in for a key in the log of the calls.
 *
 * The stub records what the frontend asked the shell to do, and a key is not
 * part of that: the log of the browser build holds the shape of the call and
 * never its secret.
 */
const REDACTED = "[redacted]";

/** The tokens the browser stub replays. */
const STUB_TOKENS: readonly string[] = [
  "Arrow",
  " streams",
  " tokens",
  " in",
  " the",
  " browser",
  ".",
];

/**
 * The comment the stub adds to the text the reader selected.
 *
 * The stub stands in for the model of the shell, and the model answers with a
 * rewrite of the text the reader selected. The stub rewrites the last line of
 * that text, so the diff of the browser build holds a line the model removes
 * and a line the model adds, the way the diff of the shell does.
 */
const STUB_EDIT_MARKER = " // the model rewrote this line";

/** The gap between two tokens of the stub, in milliseconds. */
const STUB_TOKEN_DELAY_MS = 30;

/**
 * The text the stub proposes for the selection of the reader.
 *
 * The last line of the selection carries the comment of the stub, and the
 * rest of the text stays as the reader left it.
 */
function editProposal(selection: unknown): string {
  const text = typeof selection === "string" ? selection : "";
  if (text === "") return STUB_EDIT_MARKER.trim();

  const lines = text.split("\n");
  const last = lines.length - 1;
  const lastLine = lines[last] ?? "";
  lines[last] = `${lastLine}${STUB_EDIT_MARKER}`;

  return lines.join("\n");
}

/**
 * The pieces the stub streams the proposal in.
 *
 * The proposal arrives in pieces, so the diff of the browser build grows the
 * way the diff of the shell grows.
 */
function editTokens(proposal: string): readonly string[] {
  return proposal.match(/\S+\s*/g) ?? [];
}

/** The listeners of one request. */
interface StubListeners {
  readonly tokens: Set<(payload: AiTokenPayload) => void>;
  readonly completes: Set<(payload: AiCompletePayload) => void>;
  readonly errors: Set<(payload: AiErrorPayload) => void>;
}

/**
 * The browser stand-in for the Rust AI commands.
 *
 * It records every call so the end to end suite can read what the frontend
 * asked the shell to do, and it replays the token stream the way Rust does:
 * one event per token and one event at the end.
 *
 * The keychain of the shell is a keychain here too: the stub remembers which
 * providers have a key, and it never keeps the key itself.
 */
class AiStub {
  private readonly calls: AiCall[] = [];
  private readonly listeners = new Map<string, StubListeners>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private readonly received: string[] = [];
  private readonly keys = new Set<AiProvider>();
  private finished = false;
  private tokenDelayMs = STUB_TOKEN_DELAY_MS;

  /**
   * The gap the stub waits between two tokens.
   *
   * The gap is short by default, so a case that only waits for the stream
   * does not spend its time. A case that needs a stream that stays open, such
   * as the one that reads the state of the screen while the request runs,
   * asks for a longer one.
   */
  setTokenDelay(ms: number): void {
    this.tokenDelayMs = ms;
  }

  /** The commands the frontend sent, in order. */
  get commandLog(): readonly AiCall[] {
    return this.calls;
  }

  /** The tokens the boundary received, in order. */
  get tokens(): readonly string[] {
    return this.received;
  }

  /** True when the last stream ended. */
  get done(): boolean {
    return this.finished;
  }

  /** Record a call and answer with the canned stream of tokens. */
  complete(requestId: string, args: Readonly<Record<string, unknown>>): void {
    this.calls.push({ command: "complete", args });
    this.replay(requestId, STUB_TOKENS);
  }

  /** Record a call and answer with the canned stream of the proposed edit. */
  inlineEdit(requestId: string, args: Readonly<Record<string, unknown>>): void {
    this.calls.push({ command: "inline_edit", args });
    this.replay(requestId, editTokens(editProposal(args.selection)));
  }

  /** Record a call and stop the stream of a request. */
  cancel(requestId: string): void {
    this.calls.push({ command: "cancel_request", args: { requestId } });
    this.stop(requestId);
  }

  /** Record a call. The key is never part of the record. */
  setKey(provider: AiProvider): void {
    this.calls.push({ command: "set_api_key", args: { provider, key: REDACTED } });
    this.keys.add(provider);
  }

  /** Record a call and answer whether the provider has a key. */
  getKey(provider: AiProvider): boolean {
    this.calls.push({ command: "get_api_key", args: { provider } });
    return this.keys.has(provider);
  }

  /** Record a call. */
  deleteKey(provider: AiProvider): void {
    this.calls.push({ command: "delete_api_key", args: { provider } });
    this.keys.delete(provider);
  }

  /** The listeners of a request. */
  private listenersOf(requestId: string): StubListeners {
    const existing = this.listeners.get(requestId);
    if (existing) return existing;

    const listeners: StubListeners = {
      tokens: new Set(),
      completes: new Set(),
      errors: new Set(),
    };
    this.listeners.set(requestId, listeners);
    return listeners;
  }

  /** Replay the canned stream of one request. */
  private replay(requestId: string, tokens: readonly string[]): void {
    this.stop(requestId);
    this.finished = false;

    const timers: ReturnType<typeof setTimeout>[] = [];
    this.timers.set(requestId, timers);

    tokens.forEach((token, index) => {
      const timer = setTimeout(
        () => {
          this.received.push(token);
          for (const listener of this.listenersOf(requestId).tokens) {
            listener({ token, done: false });
          }

          if (index === tokens.length - 1) {
            this.finished = true;
            for (const listener of this.listenersOf(requestId).completes) {
              listener({ done: true });
            }
          }
        },
        this.tokenDelayMs * (index + 1),
      );

      timers.push(timer);
    });
  }

  /** Stop the stream of a request. */
  private stop(requestId: string): void {
    const timers = this.timers.get(requestId);
    if (!timers) return;

    for (const timer of timers) clearTimeout(timer);
    this.timers.delete(requestId);
  }

  /** Listen for the tokens of a request. */
  onToken(requestId: string, handler: (payload: AiTokenPayload) => void): UnlistenFn {
    const listeners = this.listenersOf(requestId);
    listeners.tokens.add(handler);
    return () => listeners.tokens.delete(handler);
  }

  /** Listen for the end of a request. */
  onComplete(requestId: string, handler: (payload: AiCompletePayload) => void): UnlistenFn {
    const listeners = this.listenersOf(requestId);
    listeners.completes.add(handler);
    return () => listeners.completes.delete(handler);
  }

  /** Listen for the failure of a request. */
  onError(requestId: string, handler: (payload: AiErrorPayload) => void): UnlistenFn {
    const listeners = this.listenersOf(requestId);
    listeners.errors.add(handler);
    return () => listeners.errors.delete(handler);
  }
}

/** The stub of the AI boundary, used only when the app runs in a plain browser. */
export const aiStub = new AiStub();

/**
 * Start a completion.
 *
 * The call answers as soon as the request is under way, and the tokens arrive
 * as events of the request.
 */
export async function startCompletion(request: CompletionRequest): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("complete", {
      requestId: request.requestId,
      provider: request.provider,
      model: request.model,
      prompt: request.prompt,
      context: request.context,
    });
    return;
  }

  aiStub.complete(request.requestId, {
    requestId: request.requestId,
    provider: request.provider,
    model: request.model,
    prompt: request.prompt,
    context: request.context,
  });
}

/**
 * Start an inline edit.
 *
 * The edit produces the same events as a completion, and the same cancel path
 * ends it.
 */
export async function startInlineEdit(request: InlineEditRequest): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("inline_edit", {
      requestId: request.requestId,
      provider: request.provider,
      model: request.model,
      instruction: request.instruction,
      selection: request.selection,
    });
    return;
  }

  aiStub.inlineEdit(request.requestId, {
    requestId: request.requestId,
    provider: request.provider,
    model: request.model,
    instruction: request.instruction,
    selection: request.selection,
  });
}

/**
 * End the request of an id.
 *
 * One path serves the ghost text and the inline edit. The shell drops the
 * stream that was in flight, so the request stops.
 */
export async function cancelRequest(requestId: string): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("cancel_request", { requestId });
    return;
  }

  aiStub.cancel(requestId);
}

/**
 * Write the key of a provider into the keychain of the operating system.
 *
 * The key goes straight to the shell. This module does not keep it, does not
 * log it and does not store it.
 */
export async function setApiKey(provider: AiProvider, key: string): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("set_api_key", { provider, key });
    return;
  }

  aiStub.setKey(provider);
}

/**
 * Say whether the provider has a key.
 *
 * The answer is a boolean. The key itself never crosses the bridge.
 */
export async function hasApiKey(provider: AiProvider): Promise<boolean> {
  if (isTauriHost()) {
    const answer = await invokeCommand<boolean>("get_api_key", { provider });
    return answer ?? false;
  }

  return aiStub.getKey(provider);
}

/** Remove the key of a provider. */
export async function deleteApiKey(provider: AiProvider): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("delete_api_key", { provider });
    return;
  }

  aiStub.deleteKey(provider);
}

/** Listen for the tokens of a request. */
export async function onAiToken(
  requestId: string,
  handler: (payload: AiTokenPayload) => void,
): Promise<UnlistenFn> {
  if (isTauriHost()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<AiTokenPayload>(`ai:token:${requestId}`, (event) => handler(event.payload));
  }

  return aiStub.onToken(requestId, handler);
}

/** Listen for the end of a request. */
export async function onAiComplete(
  requestId: string,
  handler: (payload: AiCompletePayload) => void,
): Promise<UnlistenFn> {
  if (isTauriHost()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<AiCompletePayload>(`ai:complete:${requestId}`, (event) => handler(event.payload));
  }

  return aiStub.onComplete(requestId, handler);
}

/** Listen for the failure of a request. */
export async function onAiError(
  requestId: string,
  handler: (payload: AiErrorPayload) => void,
): Promise<UnlistenFn> {
  if (isTauriHost()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<AiErrorPayload>(`ai:error:${requestId}`, (event) => handler(event.payload));
  }

  return aiStub.onError(requestId, handler);
}

/**
 * The debug handle of the AI boundary.
 *
 * The end to end suite drives the AI feature through the same calls the app
 * makes, so it can prove that the tokens arrive in the frontend. It exists
 * only in a browser build.
 */
export interface AiDebug {
  /** The commands the frontend sent, in order. */
  readonly calls: readonly AiCall[];
  /** The tokens the boundary received, in order. */
  readonly tokens: readonly string[];
  /** True when the last stream ended. */
  readonly done: boolean;
  /** Start a completion and answer with the id of the request. */
  readonly start: (request: {
    readonly requestId?: string;
    readonly provider?: AiProvider;
    readonly model?: string;
    readonly prompt?: string;
    readonly context?: string;
  }) => Promise<string>;
  /** End the request of an id. */
  readonly cancel: (requestId: string) => Promise<void>;
  /** The gap the stub waits between two tokens, in milliseconds. */
  readonly setTokenDelay: (ms: number) => void;
}

declare global {
  interface Window {
    __arrowAi?: AiDebug;
  }
}

if (!isTauriHost() && typeof window !== "undefined") {
  let counter = 0;

  window.__arrowAi = {
    get calls() {
      return aiStub.commandLog;
    },
    get tokens() {
      return aiStub.tokens;
    },
    get done() {
      return aiStub.done;
    },
    start: async (request) => {
      counter += 1;
      const requestId = request.requestId ?? `stub-request-${counter}`;
      await startCompletion({
        requestId,
        provider: request.provider ?? "anthropic",
        model: request.model ?? "claude-sonnet-4-5",
        prompt: request.prompt ?? "",
        context: request.context ?? "",
      });
      return requestId;
    },
    cancel: async (requestId) => {
      await cancelRequest(requestId);
    },
    setTokenDelay: (ms) => {
      aiStub.setTokenDelay(ms);
    },
  };
}
