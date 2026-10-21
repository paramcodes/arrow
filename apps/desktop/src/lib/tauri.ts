/**
 * The Tauri boundary of the frontend.
 *
 * The desktop app runs inside a Tauri webview. The same code also runs in a
 * plain browser, where no Tauri host exists. Every call goes through this
 * module, so a missing host never crashes the browser build.
 *
 * The terminal half of the boundary follows the contract of the PTY commands:
 * `create_pty`, `write_pty`, `resize_pty`, `kill_pty` and `pty_alive`, plus the
 * `pty:data:{id}` and `pty:exit:{id}` events. The browser build has no Rust
 * host, so the stub below answers every call and replays a canned transcript.
 * It never opens a shell.
 */

/** The arguments a Tauri command takes. */
export type CommandArgs = Record<string, unknown>;

/** True when the code runs inside a Tauri webview. */
export function isTauriHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Run a Rust command.
 *
 * Returns undefined when there is no Tauri host, which is the case in a plain
 * browser. The caller decides what an absent backend means.
 */
export async function invokeCommand<T>(
  command: string,
  args: CommandArgs = {},
): Promise<T | undefined> {
  if (!isTauriHost()) {
    return undefined;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** The payload of `pty:data:{id}`: base64 bytes and their place in the stream. */
export interface PtyDataPayload {
  readonly data: string;
  readonly seq: number;
}

/** The payload of `pty:exit:{id}`. */
export interface PtyExitPayload {
  readonly code: number;
}

/** Stops a listener registered through the boundary. */
export type UnlistenFn = () => void;

/** One command the terminal boundary sent, for the end to end suite. */
export interface PtyCall {
  readonly command: "create_pty" | "write_pty" | "resize_pty" | "kill_pty" | "pty_alive";
  readonly args: CommandArgs;
}

/**
 * Starts a PTY and returns its id.
 *
 * The browser stub returns a fake id so the terminal boots without a Rust
 * host. It is never a real session.
 */
export async function createPty(cols: number, rows: number): Promise<string | undefined> {
  if (isTauriHost()) {
    return invokeCommand<string>("create_pty", { cols, rows });
  }

  return stub.createPty(cols, rows);
}

/** Writes input to the PTY. */
export async function writePty(id: string, data: string): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("write_pty", { id, data });
    return;
  }

  stub.writePty(id, data);
}

/** Tells the PTY how large the terminal is. */
export async function resizePty(id: string, cols: number, rows: number): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("resize_pty", { id, cols, rows });
    return;
  }

  stub.resizePty(id, cols, rows);
}

/** Kills the PTY behind a terminal tab. */
export async function killPty(id: string): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("kill_pty", { id });
    return;
  }

  stub.killPty(id);
}

/** True while the PTY of the id is alive. */
export async function ptyAlive(id: string): Promise<boolean> {
  if (isTauriHost()) {
    return (await invokeCommand<boolean>("pty_alive", { id })) ?? false;
  }

  return stub.alive(id);
}

/**
 * Listens for the bytes of a PTY.
 *
 * The payload carries raw bytes as base64, because a Tauri event crosses a
 * JSON boundary and a byte array does not survive it whole.
 */
export async function onPtyData(
  id: string,
  handler: (payload: PtyDataPayload) => void,
): Promise<UnlistenFn> {
  if (isTauriHost()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<PtyDataPayload>(`pty:data:${id}`, (event) => handler(event.payload));
  }

  return stub.onData(id, handler);
}

/** Listens for the end of a PTY. */
export async function onPtyExit(
  id: string,
  handler: (payload: PtyExitPayload) => void,
): Promise<UnlistenFn> {
  if (isTauriHost()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<PtyExitPayload>(`pty:exit:${id}`, (event) => handler(event.payload));
  }

  return stub.onExit(id, handler);
}

/** Encodes bytes as base64, the shape the event payload carries. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The transcript the browser stub replays.
 *
 * It is the evidence a reader sees when the app runs without a Rust host: the
 * shell answers, the prompt paints and a command returns. The bytes never
 * reach a process.
 */
const STUB_TRANSCRIPT: readonly string[] = [
  "Arrow terminal (browser stub)\r\n",
  "$ echo hello\r\nhello\r\n",
  "$ echo $ARROW_SHELL\r\narrow\r\n",
];

/** The gap between two chunks of the transcript, in milliseconds. */
const STUB_CHUNK_DELAY_MS = 40;

interface StubSession {
  readonly id: string;
  readonly dataListeners: Set<(payload: PtyDataPayload) => void>;
  readonly exitListeners: Set<(payload: PtyExitPayload) => void>;
  readonly timers: ReturnType<typeof setTimeout>[];
  cols: number;
  rows: number;
  alive: boolean;
}

/**
 * The browser stand-in for the Rust PTY.
 *
 * It records every call so the end to end suite can read what the frontend
 * asked the backend to do, and it emits `pty:data` the way Rust does: one
 * event per chunk, each with the next sequence number.
 */
class PtyStub {
  private readonly sessions = new Map<string, StubSession>();
  private readonly calls: PtyCall[] = [];
  private counter = 0;

  /** The commands the frontend sent, in order. */
  get commandLog(): readonly PtyCall[] {
    return this.calls;
  }

  createPty(cols: number, rows: number): string {
    this.counter += 1;
    const id = `stub-pty-${this.counter}`;
    const session: StubSession = {
      id,
      dataListeners: new Set(),
      exitListeners: new Set(),
      timers: [],
      cols,
      rows,
      alive: true,
    };
    this.sessions.set(id, session);
    this.calls.push({ command: "create_pty", args: { cols, rows } });

    STUB_TRANSCRIPT.forEach((chunk, index) => {
      const timer = setTimeout(
        () => {
          this.emit(id, index + 1, chunk);
        },
        STUB_CHUNK_DELAY_MS * (index + 1),
      );
      session.timers.push(timer);
    });

    return id;
  }

  writePty(id: string, data: string): void {
    this.calls.push({ command: "write_pty", args: { id, data } });
  }

  resizePty(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.cols = cols;
      session.rows = rows;
    }
    this.calls.push({ command: "resize_pty", args: { id, cols, rows } });
  }

  killPty(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      for (const timer of session.timers) clearTimeout(timer);
      session.timers.length = 0;
      session.alive = false;
    }
    this.calls.push({ command: "kill_pty", args: { id } });
  }

  alive(id: string): boolean {
    this.calls.push({ command: "pty_alive", args: { id } });
    return this.sessions.get(id)?.alive ?? false;
  }

  onData(id: string, handler: (payload: PtyDataPayload) => void): UnlistenFn {
    const session = this.sessions.get(id);
    if (!session) return () => undefined;

    session.dataListeners.add(handler);
    return () => session.dataListeners.delete(handler);
  }

  onExit(id: string, handler: (payload: PtyExitPayload) => void): UnlistenFn {
    const session = this.sessions.get(id);
    if (!session) return () => undefined;

    session.exitListeners.add(handler);
    return () => session.exitListeners.delete(handler);
  }

  /** Emits one chunk of bytes, exactly as the Rust emitter does. */
  emit(id: string, seq: number, text: string): void {
    const session = this.sessions.get(id);
    if (!session || !session.alive) return;

    const payload: PtyDataPayload = { data: encodeBase64(new TextEncoder().encode(text)), seq };
    for (const listener of session.dataListeners) listener(payload);
  }

  /** Emits the exit of a session. */
  emitExit(id: string, code: number): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.alive = false;
    for (const listener of session.exitListeners) listener({ code });
  }
}

/** The stub of the boundary, used only when the app runs in a plain browser. */
export const stub = new PtyStub();

/**
 * The debug handle of the browser stub.
 *
 * The end to end suite drives the terminal through the same events Rust
 * sends, so it can prove the gap notice of a stream that skips a sequence
 * number. It exists only in a browser build.
 */
declare global {
  interface Window {
    __arrowPtyStub?: {
      readonly calls: readonly PtyCall[];
      emitData: (id: string, seq: number, text: string) => void;
      emitExit: (id: string, code: number) => void;
    };
  }
}

if (!isTauriHost() && typeof window !== "undefined") {
  window.__arrowPtyStub = {
    calls: stub.commandLog,
    emitData: (id, seq, text) => stub.emit(id, seq, text),
    emitExit: (id, code) => stub.emitExit(id, code),
  };
}
