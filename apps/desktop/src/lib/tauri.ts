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
 *
 * The watcher and git half of the boundary follows the contract of the
 * session: `watch_directory`, `unwatch`, `git_branch`, `git_status` and
 * `git_diff_stat`, plus the `fs:changed`, `fs:created` and `fs:deleted`
 * events. The browser build answers those calls from a fixture as well, and
 * the fixture never reads the disk and never runs git.
 */

import type { GitDiffStat, GitStatus } from "./git";

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
 * The watcher and git half of the boundary.
 *
 * The desktop app asks the Rust shell to watch a directory, to stop the watch
 * and to read the git facts of a repository. The commands are
 * `watch_directory`, `unwatch`, `git_branch`, `git_status` and
 * `git_diff_stat`, and the shell answers with the shapes of
 * `apps/desktop/src/lib/git.ts`.
 *
 * The browser build has no Rust host, so the stub below answers every call
 * from a fixture. The fixture never reads the disk and never runs git: the
 * branch, the counts and the files of the status are written down here.
 */

/** The kind of change the watcher reports. */
export type FsEventKind = "changed" | "created" | "deleted";

/** One change of the disk, as the watcher reports it. */
export interface FsEvent {
  /** The kind of the change. */
  readonly kind: FsEventKind;
  /** The absolute path of the file that changed. */
  readonly path: string;
}

/** The payload every watcher event carries. */
interface FsEventPayload {
  readonly path: string;
}

/** The names of the three events the watcher sends. */
const FS_EVENT_NAMES: Readonly<Record<FsEventKind, string>> = {
  changed: "fs:changed",
  created: "fs:created",
  deleted: "fs:deleted",
};

/** The status the browser stub answers with. */
const STUB_GIT_STATUS: GitStatus = {
  branch: "main",
  modified: 1,
  staged: 0,
  untracked: 1,
  deleted: 1,
  files: [
    { path: "src/app.ts", status: "modified" },
    { path: "src/util.ts", status: "untracked" },
    { path: "README.md", status: "deleted" },
  ],
};

/** The counts of the diff the browser stub answers with. */
const STUB_GIT_DIFF_STAT: GitDiffStat = {
  filesChanged: 2,
  insertions: 12,
  deletions: 3,
};

/** The root the browser stub opens a project at. */
const STUB_PROJECT_ROOT = "/workspace";

/** One command the watcher and git boundary sent, for the end to end suite. */
export interface ShellCall {
  readonly command: "watch_directory" | "unwatch" | "git_branch" | "git_status" | "git_diff_stat";
  readonly args: CommandArgs;
}

/**
 * The browser stand-in for the watcher and for git.
 *
 * It records every call so the end to end suite can read what the frontend
 * asked the shell to do, and it emits the three changes of the watcher the
 * way Rust does.
 */
class ShellStub {
  private readonly calls: ShellCall[] = [];
  private readonly listeners = new Set<(event: FsEvent) => void>();
  private watchCounter = 0;

  /** The commands the frontend sent, in order. */
  get commandLog(): readonly ShellCall[] {
    return this.calls;
  }

  watchDirectory(path: string): string {
    this.watchCounter += 1;
    const id = `stub-watch-${this.watchCounter}`;
    this.calls.push({ command: "watch_directory", args: { path } });
    return id;
  }

  unwatch(watchId: string): void {
    this.calls.push({ command: "unwatch", args: { watch_id: watchId } });
  }

  branch(root: string): string {
    this.calls.push({ command: "git_branch", args: { root } });
    return STUB_GIT_STATUS.branch;
  }

  status(root: string): GitStatus {
    this.calls.push({ command: "git_status", args: { root } });
    return STUB_GIT_STATUS;
  }

  diffStat(root: string): GitDiffStat {
    this.calls.push({ command: "git_diff_stat", args: { root } });
    return STUB_GIT_DIFF_STAT;
  }

  pickFolder(): string {
    return STUB_PROJECT_ROOT;
  }

  onEvent(handler: (event: FsEvent) => void): UnlistenFn {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Emits one change of the disk, exactly as the Rust watcher does. */
  emit(kind: FsEventKind, path: string): void {
    for (const listener of this.listeners) listener({ kind, path });
  }
}

/** The stub of the watcher and git boundary, used only in a plain browser. */
export const shellStub = new ShellStub();

/**
 * Watches a directory and answers the id of the watch.
 *
 * The id is what the frontend hands back to stop the watch. The browser stub
 * answers a fake id, so the tree of the browser build listens for changes
 * that never come from a disk.
 */
export async function watchDirectory(path: string): Promise<string | undefined> {
  if (isTauriHost()) {
    return invokeCommand<string>("watch_directory", { path });
  }

  return shellStub.watchDirectory(path);
}

/** Stops the watch of an id. */
export async function unwatch(watchId: string): Promise<void> {
  if (isTauriHost()) {
    await invokeCommand<void>("unwatch", { watch_id: watchId });
    return;
  }

  shellStub.unwatch(watchId);
}

/** The branch of the repository at `root`. */
export async function gitBranch(root: string): Promise<string | undefined> {
  if (isTauriHost()) {
    return invokeCommand<string>("git_branch", { root });
  }

  return shellStub.branch(root);
}

/** The status of the repository at `root`. */
export async function gitStatus(root: string): Promise<GitStatus | undefined> {
  if (isTauriHost()) {
    return invokeCommand<GitStatus>("git_status", { root });
  }

  return shellStub.status(root);
}

/**
 * The counts of the diff of the repository at `root`.
 *
 * The shell names the first count in snake case and the contract of the
 * session names it in camel case, so the shell answers with both spellings
 * and the frontend reads whichever it finds.
 */
export async function gitDiffStat(root: string): Promise<GitDiffStat | undefined> {
  if (isTauriHost()) {
    const payload = await invokeCommand<{
      files_changed?: number;
      filesChanged?: number;
      insertions: number;
      deletions: number;
    }>("git_diff_stat", { root });

    if (!payload) return undefined;

    return {
      filesChanged: payload.filesChanged ?? payload.files_changed ?? 0,
      insertions: payload.insertions ?? 0,
      deletions: payload.deletions ?? 0,
    };
  }

  return shellStub.diffStat(root);
}

/**
 * Listens for the changes of the disk.
 *
 * The watcher sends three events, and every one of them carries the absolute
 * path of the file that changed. The handler receives the path and the kind
 * of the change under one shape, so the tree does not read three listeners.
 */
export async function onFsEvent(handler: (event: FsEvent) => void): Promise<UnlistenFn> {
  if (isTauriHost()) {
    const { listen } = await import("@tauri-apps/api/event");

    const stops = await Promise.all(
      (Object.keys(FS_EVENT_NAMES) as FsEventKind[]).map(async (kind) =>
        listen<FsEventPayload>(FS_EVENT_NAMES[kind], (event) =>
          handler({ kind, path: event.payload.path }),
        ),
      ),
    );

    return () => {
      for (const stop of stops) stop();
    };
  }

  return shellStub.onEvent(handler);
}

/**
 * Asks the reader for a folder.
 *
 * The picker is the dialog plugin of Tauri, which the Rust shell registers.
 * The browser build has no plugin, so the picker answers with the root of the
 * fixture workspace.
 */
export async function pickFolder(): Promise<string | null> {
  if (!isTauriHost()) {
    return shellStub.pickFolder();
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Open Folder" });

  return typeof picked === "string" ? picked : null;
}

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
    __arrowShellStub?: {
      readonly calls: readonly ShellCall[];
      emit: (kind: FsEventKind, path: string) => void;
    };
  }
}

if (!isTauriHost() && typeof window !== "undefined") {
  window.__arrowPtyStub = {
    calls: stub.commandLog,
    emitData: (id, seq, text) => stub.emit(id, seq, text),
    emitExit: (id, code) => stub.emitExit(id, code),
  };

  window.__arrowShellStub = {
    calls: shellStub.commandLog,
    emit: (kind, path) => shellStub.emit(kind, path),
  };
}
