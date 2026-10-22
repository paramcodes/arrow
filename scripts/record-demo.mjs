#!/usr/bin/env node
/**
 * Record one short clip of every feature of Arrow from the real application.
 *
 * The recorder builds the desktop application, starts a virtual display, a
 * stand-in for the AI provider and the real window, generates a workspace,
 * drives the window with synthetic X input and captures the display with
 * ffmpeg. Every clip is encoded to a GIF for the README, and the features that
 * the README shows as a picture also leave a still in `docs/images/`.
 *
 * The window is the shipped Tauri application with the embedded frontend.
 * The browser build is never recorded: `docs/images/` held Playwright
 * screenshots of it before this script existed.
 *
 * The input comes from `libX11` and `libXtst` through `scripts/demo/x11-input.py`,
 * because `xdotool` is not installed on the machine and installing it is not
 * an option. The AI clips talk to `scripts/mock-ai-server.mjs`, a local
 * stand-in for the Anthropic messages API. No provider is called, no account
 * is used and no key is needed: the only key is a dummy string the recorder
 * puts in the keychain of the operating system, and it removes it again when
 * the keychain had no key before the run.
 *
 * Usage:
 *   node scripts/record-demo.mjs [--only clip,clip] [--skip-build] [--keep]
 *
 * The workspace of every clip is generated under the system temporary
 * directory and removed when the clip ends, so the repository holds no scratch
 * folder and the tree is clean apart from the media the run writes.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { addWatchedFile, createWorkspace, touchModifiedFile } from "./demo/workspace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(ROOT, "scripts/demo/x11-input.py");
const MOCK = join(ROOT, "scripts/mock-ai-server.mjs");
const IMAGES = join(ROOT, "docs/images");
const CLIPS = join(ROOT, "docs/demo");

/** The key the recorder stores while the AI clips run. It is not a secret. */
const DEMO_KEY = "demo-local-stand-in";

/** The window title the shell opens with, from tauri.conf.json. */
const WINDOW = "Arrow";

/** The size of the virtual display. The window is 1200x800 inside it. */
const SCREEN = "1400x900x24";

/** The framerate of the capture and of the GIF. */
const CAPTURE_FPS = 12;
const GIF_FPS = 5;

/** The bytes the whole media set may take. */
const MEDIA_BUDGET = 3 * 1024 * 1024;

// The build and the launch must agree on one binary. The ambient
// CARGO_TARGET_DIR on this machine points elsewhere, and inheriting it once
// launched an older shell that opened the dev server instead of the embedded
// frontend, so the demo target is fixed here.
const CARGO_TARGET_DIR = join(homedir(), ".cache/arrow/cargo-target");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const children = new Set();

/* ------------------------------------------------------------------------- */
/* Command line                                                              */
/* ------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const keep = flag("--keep");
const skipBuild = flag("--skip-build");
const only = option("--only", "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

/* ------------------------------------------------------------------------- */
/* Processes                                                                 */
/* ------------------------------------------------------------------------- */

/** Start a process in its own group, so a kill reaches what it started. */
function start(command, args, options) {
  const child = spawn(command, args, { detached: true, ...options });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

/** Stop a process and the group it leads. */
async function stop(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return;
    }
  }
  const exited = await Promise.race([
    new Promise((done) => child.once("exit", () => done(true))),
    sleep(4000).then(() => false),
  ]);
  if (!exited) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** Stop every process the run started. */
async function stopEverything() {
  for (const child of [...children]) await stop(child);
}

/* ------------------------------------------------------------------------- */
/* The virtual display and the window                                        */
/* ------------------------------------------------------------------------- */

/** The first X display number that nothing serves. */
function freeDisplay() {
  for (let number = 90; number <= 130; number += 1) {
    if (existsSync(`/tmp/.X11-unix/X${number}`) || existsSync(`/tmp/.X${number}-lock`)) continue;
    return `:${number}`;
  }
  throw new Error("no free X display between :90 and :130");
}

/** A port derived from the worktree, so two sessions never share one. */
async function demoPort() {
  let hash = 0;
  for (const character of ROOT) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const first = 41000 + (hash % 3000);
  for (let candidate = first; candidate < first + 200; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer();
      probe.once("error", () => done(false));
      probe.once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port for the stand-in");
}

/** Start Xvfb and wait until its display opens. */
async function startDisplay(display) {
  const log = openSync(join(runDir, "xvfb.log"), "a");
  const xvfb = start("Xvfb", [display, "-screen", "0", SCREEN, "-nolisten", "tcp", "-ac"], {
    stdio: ["ignore", log, log],
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (xvfb.exitCode !== null) throw new Error("Xvfb exited before it served the display");
    const probe = drive(display, ["windows"]);
    if (probe.status === 0) return xvfb;
    await sleep(100);
  }
  throw new Error(`Xvfb did not serve ${display} within 10 seconds`);
}

/** Run the input driver. */
function drive(display, args) {
  return spawnSync("python3", [INPUT, "--display", display, ...args], { encoding: "utf8" });
}

/** Every titled window on the display. */
function windows(display) {
  const result = drive(display, ["windows"]);
  const found = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^(\d+) (\d+) (\d+) (viewable|hidden) (.*)$/.exec(line.trimEnd());
    if (!match) continue;
    found.push({
      id: Number(match[1]),
      width: Number(match[2]),
      height: Number(match[3]),
      viewable: match[4] === "viewable",
      title: match[5],
    });
  }
  return found;
}

/** The viewable window with this title, or null. */
function findWindow(display, title) {
  return windows(display).find((entry) => entry.title === title && entry.viewable) ?? null;
}

/** Wait for the window and its place on the display. */
async function waitForWindow(display, title, timeout = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (findWindow(display, title)) break;
    await sleep(250);
  }
  if (!findWindow(display, title)) throw new Error(`no viewable window titled ${title}`);
  const geometry = drive(display, ["--window", title, "geometry"]);
  const match = /^(\d+) (-?\d+) (-?\d+) (\d+) (\d+)$/.exec(geometry.stdout.trim());
  if (!match) throw new Error(`the geometry of ${title} could not be read`);
  return {
    id: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    width: Number(match[4]),
    height: Number(match[5]),
  };
}

/** Wait until a window is gone, then return. */
async function waitGone(display, title, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (!findWindow(display, title)) return;
    await sleep(200);
  }
  throw new Error(`the window ${title} did not close`);
}

/* ------------------------------------------------------------------------- */
/* Input                                                                     */
/* ------------------------------------------------------------------------- */

function input(display, args, title = WINDOW) {
  const result = drive(display, ["--window", title, ...args]);
  if (result.status !== 0) {
    throw new Error(`the input driver failed: ${result.stderr.trim()}`);
  }
}

/** Press a chord in the window. */
const key = (display, chord, title) => input(display, ["key", chord], title);

/** Type text into the window. */
const type = (display, text, title) => input(display, ["type", text], title);

/** Click a window-relative point. */
const click = (display, x, y, title) =>
  input(display, ["click", String(x), String(y), "--relative"], title);

/** Move the pointer over the window, which forces a paint under Xvfb. */
function nudge(display) {
  input(display, ["move", "600", "400"]);
  return sleep(120);
}

/** Wait for a paint to reach the screen after a state change. */
async function settle(display) {
  await nudge(display);
  await sleep(500);
}

/* ------------------------------------------------------------------------- */
/* Media                                                                     */
/* ------------------------------------------------------------------------- */

/** Start the capture of the window. */
function startCapture(display, geometry, file) {
  const log = openSync(join(runDir, "ffmpeg.log"), "a");
  return start(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-video_size",
      `${geometry.width}x${geometry.height}`,
      "-framerate",
      String(CAPTURE_FPS),
      "-i",
      `${display}+${geometry.x},${geometry.y}`,
      "-t",
      "60",
      "-y",
      file,
    ],
    { stdio: ["ignore", log, log] },
  );
}

/** End the capture and wait for the file. */
async function stopCapture(capture) {
  if (!capture || capture.exitCode !== null) return;
  capture.kill("SIGINT");
  const exited = await Promise.race([
    new Promise((done) => capture.once("exit", () => done(true))),
    sleep(8000).then(() => false),
  ]);
  if (!exited) await stop(capture, "SIGKILL");
}

/** Encode a capture to a GIF that a README can carry. */
function encodeGif(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const filter =
    `fps=${GIF_FPS},scale=800:-1:flags=lanczos,split[a][b];` +
    "[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3";
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", source, "-vf", filter, "-loop", "0", "-y", target],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`the GIF did not encode:\n${result.stderr}`);
  return statSync(target).size;
}

/** Capture one still of the window from the display, as the clip does. */
function still(display, geometry, name) {
  mkdirSync(IMAGES, { recursive: true });
  const target = join(IMAGES, name);
  // `import -window <id>` returns the empty buffer of the toplevel; WebKit
  // paints through a child surface, so the display is grabbed and cropped
  // exactly like the capture is.
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-video_size",
      `${geometry.width}x${geometry.height}`,
      "-i",
      `${display}+${geometry.x},${geometry.y}`,
      "-frames:v",
      "1",
      "-y",
      target,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`the still ${name} was not captured:\n${result.stderr}`);
  return target;
}

/* ------------------------------------------------------------------------- */
/* The stand-in and the application                                          */
/* ------------------------------------------------------------------------- */

/** Start the stand-in and wait for its port. */
async function startMock(port, answer, log) {
  const child = start("node", [MOCK, "--port", String(port), "--answer", answer], {
    stdio: ["ignore", log, log],
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("the stand-in exited before it listened");
    const listening = await new Promise((done) => {
      const probe = createServer();
      probe.once("error", () => done(false));
      probe.once("listening", () => probe.close(() => done(true)));
      probe.listen(port, "127.0.0.1");
    });
    // A port that answers as free is not serving yet, and the stand-in holds
    // it once it listens, so a failed probe is the signal that it is up.
    if (!listening) return child;
    await sleep(100);
  }
  throw new Error("the stand-in did not listen within 6 seconds");
}

/** Start the real application on the display, in the generated workspace. */
function startApp(display, workspace, port, log) {
  const env = {
    ...process.env,
    DISPLAY: display,
    GDK_BACKEND: "x11",
    WEBKIT_DISABLE_COMPOSITING_MODE: 1,
    WEBKIT_DISABLE_DMABUF_RENDERER: 1,
    LIBGL_ALWAYS_SOFTWARE: 1,
    ARROW_AI_BASE_URL: `http://127.0.0.1:${port}`,
    XDG_CONFIG_HOME: join(runDir, "config"),
    XDG_DATA_HOME: join(runDir, "data"),
    XDG_CACHE_HOME: join(runDir, "cache"),
    XDG_STATE_HOME: join(runDir, "state"),
    CARGO_TARGET_DIR,
  };
  return start(join(CARGO_TARGET_DIR, "debug/arrow-desktop"), [], {
    cwd: workspace,
    env,
    stdio: ["ignore", log, log],
  });
}

/* ------------------------------------------------------------------------- */
/* The keychain                                                              */
/* ------------------------------------------------------------------------- */

/** True when the provider has a key in the keychain. The secret is not read. */
function keyExists() {
  const lookup = spawnSync(
    "secret-tool",
    ["lookup", "service", "ai.arrow", "username", "anthropic"],
    {
      encoding: "utf8",
    },
  );
  // `secret-tool search` exits 0 when it matches nothing, so the key is read
  // back instead: only `lookup` fails when the entry is absent.
  return lookup.status === 0 && lookup.stdout.length > 0;
}

/** Remove the key the recorder stored. It never removes a key it did not store. */
function clearDemoKey() {
  spawnSync("secret-tool", ["clear", "service", "ai.arrow", "username", "anthropic"], {
    stdio: "ignore",
  });
}

/**
 * Put the demo key in the keychain through the settings dialog of the real
 * application, so the clip that shows the keychain shows a key the product
 * itself wrote. The provider is Anthropic, which the settings open on.
 */
async function ensureKey(ctx) {
  if (ctx.keyReady) return;
  if (keyExists()) {
    ctx.keyReady = true;
    return;
  }

  const log = openSync(join(runDir, "app.log"), "a");
  const workspace = join(runDir, "key-setup");
  mkdirSync(workspace, { recursive: true });
  const app = startApp(ctx.display, workspace, ctx.port, log);
  try {
    const geometry = await waitForWindow(ctx.display, WINDOW);
    await sleep(2500);
    await key(ctx.display, "ctrl+comma");
    await sleep(900);
    await click(ctx.display, 741, 296);
    await sleep(300);
    await type(ctx.display, DEMO_KEY);
    await sleep(300);
    await click(ctx.display, 809, 325);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (keyExists()) break;
      await sleep(200);
    }
    if (!keyExists()) throw new Error("the demo key did not reach the keychain");
    ctx.keyReady = true;
    ctx.keyStored = true;
    console.log("record-demo: the demo key is in the keychain, written by the settings dialog");
    await key(ctx.display, "Escape");
    await sleep(300);
    void geometry;
  } finally {
    await stop(app);
  }
}

/* ------------------------------------------------------------------------- */
/* The clips                                                                 */
/* ------------------------------------------------------------------------- */

/** Open the workspace as the project of the window. */
async function openFolder(ctx) {
  await key(ctx.display, "ctrl+o");
  await waitForWindow(ctx.display, "Open Folder", 10_000);
  await key(ctx.display, "ctrl+l", "Open Folder");
  await sleep(700);
  await type(ctx.display, ctx.workspace, "Open Folder");
  await sleep(900);
  // The location entry can take the first Return for a completion, so the
  // folder is confirmed with a second one while the dialog is still open.
  await key(ctx.display, "Return", "Open Folder");
  await sleep(900);
  if (findWindow(ctx.display, "Open Folder")) {
    await key(ctx.display, "Return", "Open Folder");
  }
  await waitGone(ctx.display, "Open Folder", 8_000);
  await sleep(1400);
  await settle(ctx.display);
}

/** Open a file by name through quick open. */
async function openFile(ctx, name) {
  await key(ctx.display, "ctrl+p");
  await sleep(900);
  await key(ctx.display, "ctrl+a");
  await type(ctx.display, name);
  await sleep(900);
  await key(ctx.display, "Return");
  await sleep(1600);
  // A palette that held no match stays open and would take the next chord.
  await key(ctx.display, "Escape");
  await sleep(200);
}

/** Open the settings dialog. */
async function openSettings(ctx) {
  await key(ctx.display, "ctrl+comma");
  await sleep(900);
}

/** Read a file of the generated workspace. */
function readWorkspace(ctx, path) {
  return readFileSync(join(ctx.workspace, path), "utf8");
}

const clipList = [
  {
    name: "first-run",
    ai: null,
    run: async (ctx) => {
      // The README's picture of a fresh window comes from this state, before
      // a file is open and with no key in the keychain.
      await settle(ctx.display);
      still(ctx.display, ctx.geometry, "arrow-shell.png");
      await sleep(600);
      await click(ctx.display, 1000, 790);
      await sleep(1400);
      await settle(ctx.display);
      await key(ctx.display, "Escape");
      await sleep(500);
    },
  },
  {
    name: "tree-follows-disk",
    ai: null,
    run: async (ctx) => {
      await openFolder(ctx);
      await sleep(900);
      addWatchedFile(ctx.workspace, "added-by-the-watcher.md", "# a new file\n");
      await sleep(1500);
      await touchModifiedFile(ctx.workspace);
      await sleep(1500);
    },
  },
  {
    name: "editor-tabs",
    ai: null,
    run: async (ctx) => {
      await openFolder(ctx);
      await openFile(ctx, "sum.ts");
      await openFile(ctx, "greet.ts");
      await click(ctx.display, 500, 100);
      await sleep(300);
      await key(ctx.display, "End");
      await type(ctx.display, " // demo");
      await sleep(1200);
      await settle(ctx.display);
      await key(ctx.display, "ctrl+s");
      await sleep(900);
      const saved = readWorkspace(ctx, "src/greet.ts");
      if (!saved.includes("// demo")) {
        throw new Error("the editor did not write the file back on Ctrl+S");
      }
      console.log("record-demo: Ctrl+S wrote src/greet.ts to the disk");
    },
  },
  {
    name: "ghost-text",
    ai: "completion",
    needsKey: true,
    run: async (ctx) => {
      await openFolder(ctx);
      await openFile(ctx, "sum.ts");
      await click(ctx.display, 500, 129);
      await sleep(300);
      await type(ctx.display, "const doubled = ");
      await sleep(2600);
      await nudge(ctx.display);
      await sleep(600);
      still(ctx.display, ctx.geometry, "ghost-text.png");
      await sleep(500);
      await key(ctx.display, "Tab");
      await sleep(400);
      await key(ctx.display, "ctrl+s");
      await sleep(700);
      const saved = readWorkspace(ctx, "src/sum.ts");
      if (!saved.includes("value * 2")) {
        throw new Error("the ghost text was not taken into the document");
      }
      console.log("record-demo: the ghost text was taken with Tab and saved");
    },
  },
  {
    name: "inline-edit",
    ai: "inline",
    needsKey: true,
    run: async (ctx) => {
      await openFolder(ctx);
      await openFile(ctx, "sum.ts");
      await click(ctx.display, 500, 100);
      await sleep(300);
      await key(ctx.display, "Home");
      await key(ctx.display, "shift+End");
      await key(ctx.display, "ctrl+k");
      await sleep(900);
      await type(ctx.display, "double the result");
      await key(ctx.display, "Return");
      await sleep(2600);
      await nudge(ctx.display);
      await sleep(500);
      still(ctx.display, ctx.geometry, "inline-diff.png");
      await sleep(500);
      await key(ctx.display, "ctrl+Return");
      await sleep(600);
      await key(ctx.display, "ctrl+s");
      await sleep(800);
      const saved = readWorkspace(ctx, "src/sum.ts");
      if (!saved.includes("(a + b) * 2")) {
        throw new Error("the inline edit was not taken into the document");
      }
      console.log("record-demo: the inline edit was taken with Ctrl+Enter and saved");
    },
  },
  {
    name: "settings-model",
    ai: null,
    needsKey: true,
    run: async (ctx) => {
      await openFolder(ctx);
      await openSettings(ctx);
      await sleep(500);
      await click(ctx.display, 467, 217);
      await sleep(700);
      await click(ctx.display, 398, 217);
      await sleep(700);
      await nudge(ctx.display);
      await sleep(400);
      still(ctx.display, ctx.geometry, "ai-settings.png");
      await sleep(700);
      await key(ctx.display, "Escape");
      await sleep(400);
    },
  },
  {
    name: "terminal",
    ai: null,
    run: async (ctx) => {
      await openFolder(ctx);
      await key(ctx.display, "ctrl+grave");
      await sleep(1600);
      await settle(ctx.display);
      await click(ctx.display, 500, 620);
      await sleep(300);
      await type(ctx.display, "echo arrow runs on a real pty");
      await key(ctx.display, "Return");
      await sleep(1200);
      await type(ctx.display, "pwd");
      await key(ctx.display, "Return");
      await sleep(1200);
    },
  },
  {
    name: "git-badges",
    ai: null,
    run: async (ctx) => {
      await openFolder(ctx);
      // The root lists .git first and src second. Opening src paints the M and
      // D badges of the files inside it.
      await click(ctx.display, 110, 60);
      await sleep(900);
      await settle(ctx.display);
      await touchModifiedFile(ctx.workspace);
      await sleep(1600);
      await settle(ctx.display);
      await sleep(1000);
    },
  },
  {
    name: "command-palette",
    ai: null,
    run: async (ctx) => {
      await key(ctx.display, "ctrl+shift+p");
      await sleep(800);
      await type(ctx.display, "terminal");
      await sleep(1000);
      await nudge(ctx.display);
      await sleep(300);
      still(ctx.display, ctx.geometry, "command-palette.png");
      await sleep(900);
      await key(ctx.display, "Escape");
      await sleep(400);
    },
  },
  {
    name: "project-search",
    ai: null,
    run: async (ctx) => {
      await openFolder(ctx);
      await click(ctx.display, 24, 59);
      await sleep(600);
      await click(ctx.display, 24, 59);
      await sleep(900);
      await click(ctx.display, 250, 60);
      await sleep(500);
      await type(ctx.display, "greet");
      await sleep(1700);
      await nudge(ctx.display);
      await sleep(600);
      await click(ctx.display, 150, 116);
      await sleep(1400);
    },
  },
  {
    name: "settings-dialog",
    ai: null,
    run: async (ctx) => {
      await openSettings(ctx);
      // The clip proves the dialog stored the change in its own file.
      await click(ctx.display, 829, 583);
      await sleep(800);
      await key(ctx.display, "Escape");
      await sleep(800);
      await openSettings(ctx);
      await sleep(800);
      await nudge(ctx.display);
      await sleep(500);
      await key(ctx.display, "Escape");
      await sleep(400);
      verifySettings(ctx);
    },
  },
];

/** Prove the settings dialog wrote the font size to the disk of the app. */
function verifySettings(ctx) {
  const found = [];
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(join(runDir, "config"));
  walk(join(runDir, "data"));
  const settingsFile = found.find((path) => path.endsWith("settings.json"));
  if (!settingsFile) throw new Error("the settings dialog wrote no settings.json");
  const document = JSON.parse(readFileSync(settingsFile, "utf8"));
  if (document.settings?.wordWrap !== true) {
    throw new Error(`the settings file holds ${JSON.stringify(document)}`);
  }
  console.log(`record-demo: ${settingsFile.slice(runDir.length + 1)} holds wordWrap true`);
}

/* ------------------------------------------------------------------------- */
/* The run                                                                   */
/* ------------------------------------------------------------------------- */

let runDir = "";

/** Build the web tree and the shell the way the real window build does. */
function build() {
  console.log("record-demo: building the web tree");
  const web = spawnSync("pnpm", ["--filter", "@arrow/desktop", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    timeout: 420_000,
  });
  if (web.status !== 0) throw new Error("the web tree did not build");

  console.log("record-demo: building the shell with the embedded frontend");
  const shell = spawnSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--features",
      "tauri/custom-protocol",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 1_800_000,
      env: { ...process.env, CARGO_TARGET_DIR },
    },
  );
  if (shell.status !== 0) throw new Error("the shell did not build");
}

/** Run one clip from a fresh workspace and a fresh window. */
async function recordClip(clip, ctx) {
  if (clip.needsKey) await ensureKey(ctx);

  const workspace = join(runDir, `workspace-${clip.name}`);
  // The first-run clip shows the shell before a folder is attached, so its
  // working directory stays empty.
  if (clip.name === "first-run") mkdirSync(workspace, { recursive: true });
  else createWorkspace(workspace);
  const appLog = openSync(join(runDir, `${clip.name}.app.log`), "a");
  const mockLog = openSync(join(runDir, `${clip.name}.mock.log`), "a");
  const mock = clip.ai ? await startMock(ctx.port, clip.ai, mockLog) : null;
  const app = startApp(ctx.display, workspace, ctx.port, appLog);
  const target = join(CLIPS, `${clip.name}.gif`);

  try {
    const geometry = await waitForWindow(ctx.display, WINDOW);
    await sleep(3200);
    const capture = startCapture(ctx.display, geometry, join(runDir, `${clip.name}.mp4`));
    await sleep(400);
    const clipContext = {
      ...ctx,
      workspace,
      geometry,
      still: (display, geo, name) => still(display, geo, name),
    };
    try {
      await clip.run(clipContext);
    } finally {
      await stopCapture(capture);
    }
    const bytes = encodeGif(join(runDir, `${clip.name}.mp4`), target);
    console.log(`record-demo: ${clip.name}.gif ${(bytes / 1024).toFixed(1)} KiB`);
    return { name: clip.name, bytes };
  } finally {
    await stop(app);
    if (mock) await stop(mock);
    await sleep(300);
    if (!keep) rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const chosen = clipList.filter((clip) => only.length === 0 || only.includes(clip.name));
  if (chosen.length === 0) {
    throw new Error(
      `no clip matches ${only.join(",")}; the clips are ${clipList.map((clip) => clip.name).join(", ")}`,
    );
  }

  runDir = mkdtempSync(join(tmpdir(), "arrow-demo-"));
  mkdirSync(CLIPS, { recursive: true });
  mkdirSync(IMAGES, { recursive: true });
  mkdirSync(join(runDir, "config"), { recursive: true });
  mkdirSync(join(runDir, "data"), { recursive: true });

  console.log(`record-demo: the workspace of each clip is generated under ${runDir}`);
  console.log(`record-demo: the clips go to ${CLIPS}`);
  if (!skipBuild) build();
  if (!existsSync(join(CARGO_TARGET_DIR, "debug/arrow-desktop"))) {
    throw new Error(`the shell binary is missing at ${CARGO_TARGET_DIR}/debug/arrow-desktop`);
  }

  const display = freeDisplay();
  const port = await demoPort();
  console.log(`record-demo: display ${display}, local stand-in port ${port}`);

  const xvfb = await startDisplay(display);
  const keyPresentBefore = keyExists();
  const ctx = {
    display,
    port,
    keyReady: keyPresentBefore,
    keyStored: false,
  };
  const results = [];

  try {
    for (const clip of chosen) {
      if (clip.name === "first-run" && keyPresentBefore) {
        console.warn(
          "record-demo: a key is already in the keychain, so the no-key state of first-run cannot be shown; skipping it",
        );
        continue;
      }
      results.push(await recordClip(clip, ctx));
    }
  } finally {
    await stopEverything();
    await stop(xvfb);
    if (ctx.keyStored) {
      clearDemoKey();
      console.log("record-demo: the demo key is gone from the keychain");
    }
    if (keep) console.log(`record-demo: the run directory is kept at ${runDir}`);
    else rmSync(runDir, { recursive: true, force: true });
  }

  let total = 0;
  for (const result of results) {
    console.log(
      `record-demo: ${result.name.padEnd(20)} ${(result.bytes / 1024).toFixed(1).padStart(8)} KiB`,
    );
    total += result.bytes;
  }
  for (const name of readdirSync(IMAGES)) {
    const path = join(IMAGES, name);
    if (name.endsWith(".png")) total += statSync(path).size;
  }
  console.log(
    `record-demo: media total ${(total / 1024 / 1024).toFixed(2)} MiB of a 3.00 MiB budget`,
  );
  if (total > MEDIA_BUDGET) throw new Error("the media set is over its budget");
  console.log("record-demo: done");
}

process.on("SIGINT", () => {
  void stopEverything().then(() => process.exit(130));
});
process.on("SIGTERM", () => {
  void stopEverything().then(() => process.exit(143));
});

main().catch(async (failure) => {
  console.error(`record-demo: FAIL ${failure instanceof Error ? failure.stack : failure}`);
  await stopEverything();
  process.exit(1);
});
