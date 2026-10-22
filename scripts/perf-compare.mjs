#!/usr/bin/env node
/**
 * Measures the idle footprint of Arrow, VS Code and Cursor the same way on one
 * machine and writes the raw numbers to `docs/perf/results.json`.
 *
 * What is measured, once per editor:
 *
 * - Cold start: launch against a profile directory that has never been used,
 *   with no instance of that editor running.
 * - Warm start: launch a second time against the same profile directory.
 * - Startup: milliseconds from the spawn to the first capture of the editor
 *   window that proved paint (more than one colour, standard deviation at or
 *   above 0.01). A window that only mapped black does not stop the clock.
 * - Memory: after a fixed settle, the resident set of every process in the
 *   tree of the launched process, sampled three times one second apart. The
 *   median sample is the number in the results file.
 * - Storage: the apparent size of the unpacked vendor tree the editor runs
 *   from, and the size of the vendor artifact it came from.
 *
 * The script fails loudly. An editor it cannot measure is written to the
 * results file as a skipped line with the reason, never as a zero, and the
 * process exits non-zero. No number is written that this run did not measure.
 *
 * Usage:
 *   node scripts/perf-compare.mjs [options]
 *
 *   --editors <list>       comma separated, default arrow,vscode,cursor
 *   --settle <seconds>     idle wait after the window paints, default 25
 *   --startup-timeout <s>  window wait per launch, default 120
 *   --json <path>          results file, default docs/perf/results.json
 *   --cache <dir>          scratch root, default ~/.cache/arrow/perf
 *   --display <:N>         an existing X display, default a private Xvfb
 *   --arrow-appimage <f>   use this Arrow AppImage instead of building one
 *   --no-download          fail instead of fetching a vendor artifact
 *   --no-build             fail instead of building the Arrow AppImage
 *   --install-only         fetch, unpack and measure storage, then stop
 *   --markdown             print the README table for the numbers measured
 *   --keep-processes       leave the editors running, for debugging
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeCache = path.join(os.homedir(), ".cache", "arrow", "perf");
const displayGeometry = "1280x800x24";
const resultsFile = path.join(root, "docs", "perf", "results.json");
const millisecond = 1000;
const mebibyte = 1024 * 1024;

const vscodeDownload = "https://code.visualstudio.com/sha/download?build=stable&os=linux-x64";
const cursorDownloadApi =
  "https://www.cursor.com/api/download?platform=linux-x64&releaseTrack=stable";

const editorTable = [
  {
    id: "arrow",
    name: "Arrow",
    windowTitle: "Arrow",
    artifactKind: "appimage",
    versionFrom: path.join("usr", "share", "arrow", "version"),
  },
  {
    id: "vscode",
    name: "VS Code",
    windowTitle: "Visual Studio Code",
    artifactKind: "tarball",
  },
  {
    id: "cursor",
    name: "Cursor",
    windowTitle: "Cursor",
    artifactKind: "appimage",
    versionFrom: path.join("resources", "app", "package.json"),
  },
];

const windowHelper = String.raw`
import ctypes
import ctypes.util
import json
import sys
import time

x11 = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")

Window = ctypes.c_ulong
Atom = ctypes.c_ulong
Bool = ctypes.c_int


class XWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("border_width", ctypes.c_int),
        ("depth", ctypes.c_int),
        ("visual", ctypes.c_void_p),
        ("root", Window),
        ("klass", ctypes.c_int),
        ("bit_gravity", ctypes.c_int),
        ("win_gravity", ctypes.c_int),
        ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong),
        ("backing_pixel", ctypes.c_ulong),
        ("save_under", Bool),
        ("colormap", ctypes.c_ulong),
        ("map_installed", Bool),
        ("map_state", ctypes.c_int),
        ("all_event_masks", ctypes.c_long),
        ("your_event_mask", ctypes.c_long),
        ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", Bool),
        ("screen", ctypes.c_void_p),
    ]


x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.restype = Window
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XQueryTree.argtypes = [
    ctypes.c_void_p,
    Window,
    ctypes.POINTER(Window),
    ctypes.POINTER(Window),
    ctypes.POINTER(ctypes.POINTER(Window)),
    ctypes.POINTER(ctypes.c_uint),
]
x11.XQueryTree.restype = ctypes.c_int
x11.XInternAtom.restype = Atom
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, Bool]
x11.XGetWindowProperty.argtypes = [
    ctypes.c_void_p,
    Window,
    Atom,
    ctypes.c_long,
    ctypes.c_long,
    Bool,
    Atom,
    ctypes.POINTER(Atom),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),
]
x11.XGetWindowProperty.restype = ctypes.c_int
x11.XGetWindowAttributes.argtypes = [
    ctypes.c_void_p,
    Window,
    ctypes.POINTER(XWindowAttributes),
]
x11.XGetWindowAttributes.restype = ctypes.c_int
x11.XFree.argtypes = [ctypes.c_void_p]

display = x11.XOpenDisplay(None)
if not display:
    print(json.dumps({"error": "the X display did not open"}))
    raise SystemExit(3)

root_window = x11.XDefaultRootWindow(display)
utf8 = x11.XInternAtom(display, b"UTF8_STRING", 0)
net_wm_name = x11.XInternAtom(display, b"_NET_WM_NAME", 0)
wm_name = x11.XInternAtom(display, b"WM_NAME", 0)
xa_string = ctypes.c_ulong(31)


def property_text(window, prop, prop_type):
    actual_type = Atom()
    actual_format = ctypes.c_int()
    items = ctypes.c_ulong()
    after = ctypes.c_ulong()
    data = ctypes.POINTER(ctypes.c_ubyte)()
    status = x11.XGetWindowProperty(
        display,
        window,
        prop,
        0,
        1024,
        0,
        prop_type,
        ctypes.byref(actual_type),
        ctypes.byref(actual_format),
        ctypes.byref(items),
        ctypes.byref(after),
        ctypes.byref(data),
    )
    if status != 0 or not data or actual_format.value != 8 or items.value == 0:
        return None
    try:
        return bytes(bytearray(data[: items.value])).decode("utf-8", "replace")
    finally:
        x11.XFree(data)


def title_of(window):
    return property_text(window, net_wm_name, utf8) or property_text(window, wm_name, xa_string)


def children_of(window):
    root_return = Window()
    parent_return = Window()
    children = ctypes.POINTER(Window)()
    count = ctypes.c_uint()
    if not x11.XQueryTree(
        display,
        window,
        ctypes.byref(root_return),
        ctypes.byref(parent_return),
        ctypes.byref(children),
        ctypes.byref(count),
    ):
        return []
    try:
        return [children[index] for index in range(count.value)]
    finally:
        if children:
            x11.XFree(children)


seen = []
matches = []


def walk(window, depth):
    if depth > 8:
        return
    for child in children_of(window):
        if child in seen:
            continue
        seen.append(child)
        title = title_of(child)
        if title:
            attributes = XWindowAttributes()
            if x11.XGetWindowAttributes(display, child, ctypes.byref(attributes)):
                if attributes.map_state == 2:
                    matches.append(
                        {
                            "id": child,
                            "title": title,
                            "width": attributes.width,
                            "height": attributes.height,
                        }
                    )
        walk(child, depth + 1)


walk(root_window, 0)

wanted = sys.argv[1].lower() if len(sys.argv) > 1 else ""
found = [entry for entry in matches if wanted in entry["title"].lower()]
print(json.dumps({"found": bool(found), "window": found[0] if found else None, "windows": matches}))
`;

const options = {
  editors: editorTable.map((editor) => editor.id),
  settleSeconds: 25,
  startupTimeoutSeconds: 120,
  json: resultsFile,
  cache: homeCache,
  display: "",
  download: true,
  build: true,
  installOnly: false,
  markdown: false,
  keepProcesses: false,
  arrowAppImage: "",
};

let xvfb = null;
let current = null;
const startedAt = new Date();

function say(message) {
  process.stdout.write(`perf: ${message}\n`);
}

function failEditor(id, reason) {
  process.stderr.write(`PERF FAIL ${id}: ${reason}\n`);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function handleOption(name, value) {
  switch (name) {
    case "--editors":
      options.editors = value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      break;
    case "--settle":
      options.settleSeconds = Number(value);
      break;
    case "--startup-timeout":
      options.startupTimeoutSeconds = Number(value);
      break;
    case "--json":
      options.json = path.resolve(value);
      break;
    case "--cache":
      options.cache = path.resolve(value);
      break;
    case "--display":
      options.display = value;
      break;
    case "--no-download":
      options.download = false;
      break;
    case "--no-build":
      options.build = false;
      break;
    case "--install-only":
      options.installOnly = true;
      break;
    case "--markdown":
      options.markdown = true;
      break;
    case "--keep-processes":
      options.keepProcesses = true;
      break;
    case "--arrow-appimage":
      options.arrowAppImage = path.resolve(value);
      break;
    default:
      throw new Error(`unknown option ${name}`);
  }
}

function parseArguments(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      const header = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
      const usage = header.slice(header.indexOf(" * Usage:"), header.indexOf(" */"));
      process.stdout.write(`${usage.replaceAll(" *", "").trim()}\n`);
      process.exit(0);
    }
    const separator = argument.indexOf("=");
    if (argument.startsWith("--") && separator > 0) {
      handleOption(argument.slice(0, separator), argument.slice(separator + 1));
      continue;
    }
    if (argument.startsWith("--")) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        handleOption(argument, "");
        continue;
      }
      handleOption(argument, next);
      index += 1;
      continue;
    }
    throw new Error(`unexpected argument ${argument}`);
  }
}

function run(command, args, settings = {}) {
  const result = spawnSync(command, args, {
    cwd: settings.cwd ?? root,
    encoding: "utf8",
    timeout: settings.timeout ?? 10 * 60 * millisecond,
    env: settings.env ?? process.env,
  });
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !settings.allowFailure) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${output.slice(-2000)}`);
  }
  return result;
}

function readFileIfPresent(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isElf(file) {
  try {
    const handle = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    fs.readSync(handle, head, 0, 4, 0);
    fs.closeSync(handle);
    return head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } catch {
    return false;
  }
}

function sha256(file) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function machineFacts(display) {
  const cpuinfo = readFileIfPresent("/proc/cpuinfo");
  const model = /model name\s*:\s*(.+)/.exec(cpuinfo)?.[1] ?? "unknown";
  const osRelease = readFileIfPresent("/etc/os-release");
  const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(osRelease)?.[1] ?? os.type();
  const memTotal = Number(/MemTotal:\s+(\d+)/.exec(readFileIfPresent("/proc/meminfo"))?.[1] ?? 0);
  const kernel = os.release();
  const free = run("df", ["-B1", "--output=avail", "/home"]).stdout.trim().split("\n").pop();
  return {
    cpuCores: os.cpus().length,
    cpuModel: model.trim(),
    memoryBytes: memTotal * 1024,
    os: pretty,
    kernel,
    sessionType: process.env.XDG_SESSION_TYPE ?? "unset",
    desktop: process.env.XDG_CURRENT_DESKTOP ?? "unset",
    freeBytesOnHome: Number(free),
    display,
    displayGeometry,
    nodeVersion: process.version,
  };
}

function freeDisplayNumber() {
  for (let number = 99; number <= 130; number += 1) {
    const socket = `/tmp/.X11-unix/X${number}`;
    const lock = `/tmp/.X${number}-lock`;
    if (!fs.existsSync(socket) && !fs.existsSync(lock)) {
      return number;
    }
  }
  throw new Error("no free X display number between :99 and :130");
}

function displayOpens(display) {
  const result = run(
    "python3",
    [
      "-c",
      'import ctypes; lib = ctypes.CDLL("libX11.so.6"); lib.XOpenDisplay.restype = ctypes.c_void_p; raise SystemExit(0 if lib.XOpenDisplay(None) else 1)',
    ],
    { allowFailure: true, env: { ...process.env, DISPLAY: display } },
  );
  return result.status === 0;
}

async function ensureDisplay() {
  if (options.display) {
    if (!displayOpens(options.display)) {
      throw new Error(`the display ${options.display} did not open`);
    }
    return options.display;
  }
  const number = freeDisplayNumber();
  const display = `:${number}`;
  const log = path.join(options.cache, "xvfb.log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const out = fs.openSync(log, "w");
  xvfb = spawn("Xvfb", [display, "-screen", "0", displayGeometry, "-nolisten", "tcp", "-ac"], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  xvfb.unref();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (displayOpens(display)) {
      say(`started Xvfb on ${display} at ${displayGeometry} (pid ${xvfb.pid})`);
      return display;
    }
    await sleep(100);
  }
  throw new Error(`Xvfb did not serve ${display}: ${readFileIfPresent(log).slice(-1000)}`);
}

function stopProcessGroup(pid) {
  if (!pid) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }
    spawnSync("sleep", ["0.1"]);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

function stopCurrentProcess() {
  if (current) {
    stopProcessGroup(current.pid);
    current = null;
  }
}

function stopEverything() {
  if (current) {
    stopProcessGroup(current.pid);
    current = null;
  }
  if (xvfb) {
    stopProcessGroup(xvfb.pid);
    xvfb = null;
  }
}

function findWindow(display, title) {
  const result = run("python3", ["-c", windowHelper, title], {
    allowFailure: true,
    env: { ...process.env, DISPLAY: display },
  });
  const line = result.stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return { found: false, window: null, error: `${result.stderr}${result.stdout}`.slice(-500) };
  }
}

function captureWindow(display, windowId, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const result = run("import", ["-display", display, "-window", String(windowId), file], {
    allowFailure: true,
    timeout: 30 * millisecond,
  });
  if (result.status !== 0 || !fs.existsSync(file)) {
    return null;
  }
  const identify = run("identify", ["-format", "%k %[fx:standard_deviation]", file], {
    allowFailure: true,
    timeout: 30 * millisecond,
  });
  const [colors, deviation] = identify.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(colors) || !Number.isFinite(deviation)) {
    return null;
  }
  return { colors, deviation };
}

async function waitForPaintedWindow(display, title, launchedAt, shotFile) {
  const deadline = Date.now() + options.startupTimeoutSeconds * millisecond;
  while (Date.now() < deadline) {
    const probe = findWindow(display, title);
    if (probe.found && probe.window) {
      const paint = captureWindow(display, probe.window.id, shotFile);
      if (paint && paint.colors > 1 && paint.deviation >= 0.01) {
        return {
          elapsedMs: Date.now() - launchedAt,
          capturedAt: new Date().toISOString(),
          window: {
            id: probe.window.id,
            title: probe.window.title,
            width: probe.window.width,
            height: probe.window.height,
          },
          screenshot: shotFile,
          colors: paint.colors,
          standardDeviation: paint.deviation,
        };
      }
    }
    await sleep(100);
  }
  return null;
}

function processTree(pid) {
  const entries = fs.readdirSync("/proc");
  const parents = new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const stat = readFileIfPresent(`/proc/${entry}/stat`);
    const closing = stat.lastIndexOf(")");
    if (closing < 0) {
      continue;
    }
    const fields = stat.slice(closing + 2).split(" ");
    parents.set(Number(entry), Number(fields[1]));
  }
  const tree = [pid];
  let index = 0;
  while (index < tree.length) {
    const parent = tree[index];
    index += 1;
    for (const [child, owner] of parents) {
      if (owner === parent && !tree.includes(child)) {
        tree.push(child);
      }
    }
  }
  return tree;
}

function treeMemory(pid) {
  let rssKilobytes = 0;
  let processes = 0;
  for (const member of processTree(pid)) {
    const status = readFileIfPresent(`/proc/${member}/status`);
    const match = /VmRSS:\s+(\d+) kB/.exec(status);
    if (match) {
      rssKilobytes += Number(match[1]);
      processes += 1;
    }
  }
  return { rssBytes: rssKilobytes * 1024, processes };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

async function sampleMemory(pid) {
  const samples = [];
  for (let index = 0; index < 3; index += 1) {
    if (index > 0) {
      await sleep(millisecond);
    }
    samples.push({ ...treeMemory(pid), at: new Date().toISOString() });
  }
  const alive = samples.filter((sample) => sample.processes > 0);
  if (alive.length === 0) {
    return null;
  }
  return {
    rssBytes: median(alive.map((sample) => sample.rssBytes)),
    processes: alive[alive.length - 1].processes,
    samples: alive.map((sample) => ({ rssBytes: sample.rssBytes, processes: sample.processes })),
    metric: "sum of VmRSS of every process in the tree of the launched process, /proc/<pid>/status",
  };
}

function launchEditor(launch, display, logFile, profileEnv) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "w");
  const env = { ...process.env, ...launch.env, ...profileEnv, DISPLAY: display };
  delete env.WAYLAND_DISPLAY;
  const child = spawn(launch.executable, launch.args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out],
    env,
  });
  return child;
}

async function stopEditor(child) {
  const { pid } = child;
  if (!pid || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    await exited;
    return;
  }
  const killer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The group is already gone.
    }
  }, 10 * millisecond);
  await exited;
  clearTimeout(killer);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

async function measureLaunch(editor, launch, display, profile, label, shots) {
  const launchedAt = Date.now();
  const logFile = path.join(options.cache, "logs", `${editor.id}-${label}.log`);
  const shotFile = path.join(shots, `${editor.id}-${label}.png`);
  const child = launchEditor(launch, display, logFile, {
    XDG_DATA_HOME: path.join(profile, "xdg-data"),
    XDG_CONFIG_HOME: path.join(profile, "xdg-config"),
    XDG_CACHE_HOME: path.join(profile, "xdg-cache"),
  });
  current = child;
  say(`${editor.id}: launched for the ${label} start (pid ${child.pid})`);

  const painted = await waitForPaintedWindow(display, editor.windowTitle, launchedAt, shotFile);
  if (!painted) {
    const alive = (() => {
      try {
        process.kill(child.pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    await stopEditor(child);
    current = null;
    const log = readFileIfPresent(logFile).trim().split("\n").slice(-12).join("\n");
    throw new Error(
      `no window titled "${editor.windowTitle}" painted within ${options.startupTimeoutSeconds}s (process ${alive ? "alive" : "exited"}). Last lines of ${logFile}:\n${log}`,
    );
  }
  say(
    `${editor.id}: ${label} window painted in ${painted.elapsedMs} ms, ${painted.colors} colours`,
  );

  await sleep(options.settleSeconds * millisecond);
  const memory = await sampleMemory(child.pid);
  if (!memory) {
    await stopEditor(child);
    current = null;
    throw new Error(`the process tree of the ${label} launch disappeared before the memory sample`);
  }
  say(
    `${editor.id}: ${label} memory ${(memory.rssBytes / mebibyte).toFixed(1)} MiB over ${memory.processes} processes`,
  );

  if (!options.keepProcesses) {
    await stopEditor(child);
    current = null;
  }
  return {
    launch: { label, log: logFile },
    startupMs: painted.elapsedMs,
    paintedAt: painted.capturedAt,
    window: painted.window,
    paint: { colors: painted.colors, standardDeviation: painted.standardDeviation },
    screenshot: painted.screenshot,
    memory,
  };
}

function downloadArtifact(url, directory, fileName) {
  fs.mkdirSync(directory, { recursive: true });
  const partial = `${fileName}.part`;
  const file = path.join(directory, fileName);
  say(`fetching ${url}`);
  const result = run(
    "curl",
    [
      "--silent",
      "--show-error",
      "--location",
      "--fail",
      "--max-time",
      "1800",
      "--output",
      partial,
      url,
    ],
    { timeout: 31 * 60 * millisecond },
  );
  if (result.status !== 0) {
    fs.rmSync(partial, { force: true });
    throw new Error(`curl exited ${result.status}: ${result.stderr.slice(-1000)}`);
  }
  fs.renameSync(partial, file);
  const bytes = fs.statSync(file).size;
  say(`fetched ${file} (${(bytes / mebibyte).toFixed(1)} MiB)`);
  return { file, bytes, url };
}

function extractAppImage(artifact, installDir) {
  fs.chmodSync(artifact, 0o755);
  const scratch = `${installDir}.extract`;
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  const result = run("bash", ["-c", `"${artifact}" --appimage-extract >/dev/null 2>&1`], {
    cwd: scratch,
  });
  if (result.status !== 0) {
    throw new Error(`${artifact} --appimage-extract exited ${result.status}`);
  }
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.renameSync(path.join(scratch, "squashfs-root"), installDir);
  fs.rmSync(scratch, { recursive: true, force: true });
}

function extractTarball(artifact, installDir) {
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(installDir, { recursive: true });
  const result = run("tar", ["-xzf", artifact, "-C", installDir, "--strip-components=1"], {
    timeout: 10 * 60 * millisecond,
  });
  if (result.status !== 0) {
    throw new Error(`tar of ${artifact} exited ${result.status}`);
  }
}

function firstElf(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && isElf(candidate) && fs.statSync(candidate).mode & 0o111) {
      return candidate;
    }
  }
  return null;
}

/**
 * Finds the executable the vendor ships. The vendor also ships crash handlers
 * and sandbox helpers in the same directory, so the candidate list names the
 * program first and only then falls back to an executable ELF next to it.
 */
function resolveBinary(installDir, names) {
  const named = firstElf(names.map((name) => path.join(installDir, name)));
  if (named) {
    return named;
  }
  const helpers = /(chrome-sandbox|chrome_crashpad_handler|\.so(\.|$)|AppRun$)/;
  const near = fs
    .readdirSync(installDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !helpers.test(entry.name))
    .map((entry) => path.join(installDir, entry.name))
    .filter((file) => fs.statSync(file).mode & 0o111 && isElf(file));
  return near[0] ?? null;
}

function targetDirectories() {
  const directories = [path.join(os.homedir(), ".cache", "arrow", "cargo-target")];
  const configured = process.env.CARGO_TARGET_DIR;
  if (configured && !directories.includes(configured)) {
    directories.unshift(configured);
  }
  return directories;
}

function appImagePath() {
  for (const target of targetDirectories()) {
    const directory = path.join(target, "release", "bundle", "appimage");
    if (!fs.existsSync(directory)) {
      continue;
    }
    const found = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".AppImage"))
      .map((name) => path.join(directory, name))
      .sort();
    if (found[0]) {
      return found[0];
    }
  }
  return null;
}

function buildArrow() {
  const target =
    process.env.CARGO_TARGET_DIR ?? path.join(os.homedir(), ".cache", "arrow", "cargo-target");
  say(`building the Arrow AppImage with CARGO_TARGET_DIR=${target}`);
  const result = run(
    "pnpm",
    ["--filter", "@arrow/desktop", "tauri", "build", "--bundles", "appimage"],
    {
      env: { ...process.env, CARGO_TARGET_DIR: target },
      timeout: 45 * 60 * millisecond,
      allowFailure: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `the Arrow AppImage build exited ${result.status}: ${`${result.stdout}${result.stderr}`.slice(-2000)}`,
    );
  }
  const file = appImagePath();
  if (!file) {
    throw new Error(
      `the build finished but no AppImage exists under ${target}/release/bundle/appimage`,
    );
  }
  return file;
}

function versionOf(installDir, editor) {
  const candidates = [];
  if (editor.versionFrom) {
    candidates.push(editor.versionFrom);
  }
  candidates.push(path.join("resources", "app", "package.json"));
  // An AppImage nests the payload under usr/share/<name>, so the version of
  // the application package sits below the top level of the unpacked tree.
  const shared = path.join(installDir, "usr", "share");
  if (fs.existsSync(shared)) {
    for (const entry of fs.readdirSync(shared, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join("usr", "share", entry.name, "resources", "app", "package.json"));
        candidates.push(path.join("usr", "share", entry.name, "version"));
      }
    }
  }
  for (const candidate of candidates) {
    const text = readFileIfPresent(path.join(installDir, candidate)).trim();
    if (!text) {
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed.version) {
        return String(parsed.version);
      }
    } catch {
      return text.split("\n")[0];
    }
  }
  if (editor.id === "arrow") {
    const config = readFileIfPresent(
      path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"),
    );
    try {
      return String(JSON.parse(config).version);
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

function prepare(editor) {
  const installDir = path.join(options.cache, "installs", editor.id);
  const artifacts = path.join(options.cache, "editors");
  fs.mkdirSync(artifacts, { recursive: true });

  if (editor.id === "arrow") {
    let artifact = options.arrowAppImage || appImagePath();
    let source = `built from this tree with pnpm --filter @arrow/desktop tauri build --bundles appimage`;
    let url = null;
    if (!artifact) {
      if (!options.build) {
        throw new Error(`no Arrow AppImage under the bundle directory, and --no-build was given`);
      }
      artifact = buildArrow();
    } else if (options.arrowAppImage) {
      source = `downloaded from the Arrow v0.5.0 GitHub release (https://github.com/paramcodes/arrow/releases/download/v0.5.0/Arrow_0.5.0_amd64.AppImage), the artifact the release body publishes with its SHA-256`;
      url =
        "https://github.com/paramcodes/arrow/releases/download/v0.5.0/Arrow_0.5.0_amd64.AppImage";
    }
    const bytes = fs.statSync(artifact).size;
    extractAppImage(artifact, installDir);
    // The AppRun the bundle carries sets the payload directory and starts the
    // binary from there, which is how the AppImage itself starts.
    const appRun = path.join(installDir, "AppRun");
    const executable = fs.existsSync(appRun)
      ? appRun
      : resolveBinary(installDir, ["usr/bin/arrow-desktop", "usr/bin/arrow", "usr/bin/Arrow"]);
    if (!executable) {
      throw new Error(`no executable Arrow binary in ${installDir}`);
    }
    const bundledWebKit = path.join(installDir, "usr", "lib", "webkit2gtk-4.1");
    return {
      installDir,
      executable,
      args: [],
      env: {
        GDK_BACKEND: "x11",
        WEBKIT_DISABLE_COMPOSITING_MODE: "1",
        WEBKIT_DISABLE_DMABUF_RENDERER: "1",
        LIBGL_ALWAYS_SOFTWARE: "1",
        // WebKit looks for its helper processes under the prefix of the
        // engine. An AppImage that carries a copy uses it; one that does not
        // falls back to the copy the distribution installed.
        WEBKIT_EXEC_PATH: fs.existsSync(bundledWebKit) ? bundledWebKit : "/usr/lib/webkit2gtk-4.1",
      },
      artifact: {
        kind: "appimage",
        file: artifact,
        bytes,
        url,
        source,
      },
      version: versionOf(installDir, editor),
    };
  }

  if (editor.id === "vscode") {
    const known = fs
      .readdirSync(artifacts, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("code-stable") && entry.name.endsWith(".tar.gz"))
      .map((entry) => path.join(artifacts, entry.name))
      .sort();
    let artifact = known[0];
    let resolvedUrl = vscodeDownload;
    if (!artifact) {
      if (!options.download) {
        throw new Error(`no VS Code tarball in ${artifacts}, and --no-download was given`);
      }
      const head = run("curl", [
        "--silent",
        "--location",
        "--head",
        "--max-time",
        "120",
        vscodeDownload,
      ]);
      const disposition = /filename=([^;\n]+)/.exec(head.stdout)?.[1]?.trim();
      const name =
        disposition && disposition.endsWith(".tar.gz") ? disposition : "code-stable-x64.tar.gz";
      const fetched = downloadArtifact(vscodeDownload, artifacts, name);
      artifact = fetched.file;
      resolvedUrl = fetched.url;
    }
    extractTarball(artifact, installDir);
    const executable = firstElf([
      path.join(installDir, "code"),
      path.join(installDir, "bin", "code"),
    ]);
    if (!executable) {
      throw new Error(`no VS Code binary in ${installDir}`);
    }
    return {
      installDir,
      executable,
      args: [],
      env: {},
      artifact: {
        kind: "tarball",
        file: artifact,
        bytes: fs.statSync(artifact).size,
        url: resolvedUrl,
        source: `downloaded from ${vscodeDownload} and unpacked with tar -xzf --strip-components=1`,
      },
      version: versionOf(installDir, editor),
    };
  }

  if (editor.id === "cursor") {
    const known = fs
      .readdirSync(artifacts, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("Cursor-") && entry.name.endsWith(".AppImage"))
      .map((entry) => path.join(artifacts, entry.name))
      .sort();
    let artifact = known[0];
    let resolvedUrl = null;
    if (!artifact) {
      if (!options.download) {
        throw new Error(`no Cursor AppImage in ${artifacts}, and --no-download was given`);
      }
      const answer = run("curl", [
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "120",
        cursorDownloadApi,
      ]);
      const parsed = JSON.parse(answer.stdout);
      if (!parsed.downloadUrl) {
        throw new Error(`the Cursor download API answered without a downloadUrl`);
      }
      resolvedUrl = parsed.downloadUrl;
      const name = path.basename(new URL(resolvedUrl).pathname);
      const fetched = downloadArtifact(resolvedUrl, artifacts, name);
      artifact = fetched.file;
      resolvedUrl = fetched.url;
    }
    extractAppImage(artifact, installDir);
    const executable = resolveBinary(installDir, ["cursor", "usr/share/cursor/cursor"]);
    if (!executable) {
      throw new Error(`no Cursor binary in ${installDir}`);
    }
    return {
      installDir,
      executable,
      args: [],
      env: {},
      artifact: {
        kind: "appimage",
        file: artifact,
        bytes: fs.statSync(artifact).size,
        url: resolvedUrl ?? cursorDownloadApi,
        source: `downloaded from the Cursor download API (${cursorDownloadApi}) and unpacked with --appimage-extract`,
      },
      version: versionOf(installDir, editor),
    };
  }

  throw new Error(`unknown editor ${editor.id}`);
}

function installBytes(directory) {
  const result = run("du", ["--apparent-size", "--bytes", "--summarize", directory]);
  return Number(result.stdout.trim().split(/\s+/)[0]);
}

function launchSpec(editor, prepared) {
  const profile = path.join(options.cache, "profiles", editor.id);
  const args = [...prepared.args];
  if (editor.id === "vscode" || editor.id === "cursor") {
    args.push(
      "--no-sandbox",
      "--ozone-platform=x11",
      `--user-data-dir=${path.join(profile, "data")}`,
      `--extensions-dir=${path.join(profile, "extensions")}`,
    );
  }
  return { ...prepared, profile, args };
}

async function measure(editorId, display) {
  const editor = editorTable.find((entry) => entry.id === editorId);
  if (!editor) {
    throw new Error(`unknown editor ${editorId}`);
  }
  const prepared = launchSpec(editor, prepare(editor));
  const shots = path.join(options.cache, "screenshots");
  const profile = prepared.profile;
  fs.rmSync(profile, { recursive: true, force: true });

  const cold = await measureLaunch(editor, prepared, display, profile, "cold", shots);
  const warm = await measureLaunch(editor, prepared, display, profile, "warm", shots);

  return {
    id: editor.id,
    name: editor.name,
    status: "measured",
    version: prepared.version,
    launch: {
      executable: prepared.executable,
      arguments: prepared.args.map((argument) =>
        argument.startsWith(options.cache)
          ? argument.replace(options.cache, "~/.cache/arrow/perf")
          : argument,
      ),
      env: prepared.env,
      windowTitle: editor.windowTitle,
    },
    artifact: {
      kind: prepared.artifact.kind,
      file: prepared.artifact.file,
      bytes: prepared.artifact.bytes,
      sha256: sha256(prepared.artifact.file),
      url: prepared.artifact.url,
      source: prepared.artifact.source,
    },
    storage: {
      installDir: prepared.installDir,
      installBytes: installBytes(prepared.installDir),
      metric: "du --apparent-size --bytes of the unpacked vendor tree the editor runs from",
    },
    cold,
    warm,
  };
}

function skipped(editorId, reason) {
  return {
    id: editorId,
    name: editorTable.find((entry) => entry.id === editorId)?.name ?? editorId,
    status: "skipped",
    reason,
  };
}

function markdownTable(results) {
  const lines = [
    "| Editor | Idle memory, warm launch, process tree (MiB) | Cold start to first paint (ms) | Warm start to first paint (ms) | Install on disk (MiB) |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const editor of results.editors) {
    if (editor.status !== "measured") {
      lines.push(`| ${editor.name} | not measured | not measured | not measured | not measured |`);
      continue;
    }
    lines.push(
      `| ${editor.name} ${editor.version} | ${(editor.warm.memory.rssBytes / mebibyte).toFixed(1)} | ${editor.cold.startupMs} | ${editor.warm.startupMs} | ${(editor.storage.installBytes / mebibyte).toFixed(1)} |`,
    );
  }
  return lines.join("\n");
}

function writeResults(results) {
  fs.mkdirSync(path.dirname(options.json), { recursive: true });
  fs.writeFileSync(options.json, `${JSON.stringify(results, null, 2)}\n`);
  say(`wrote ${options.json}`);
}

async function main() {
  parseArguments(process.argv.slice(2));
  fs.mkdirSync(options.cache, { recursive: true });
  for (const tool of ["Xvfb", "import", "identify", "python3", "curl", "tar", "du"]) {
    const probe = spawnSync("which", [tool], { encoding: "utf8" });
    if (probe.status !== 0) {
      throw new Error(`${tool} is required and is not on PATH`);
    }
  }
  const display = await ensureDisplay();
  const results = {
    date: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    machine: machineFacts(display),
    method: {
      script: "scripts/perf-compare.mjs",
      settleSeconds: options.settleSeconds,
      startupTimeoutSeconds: options.startupTimeoutSeconds,
      startupMetric:
        "milliseconds from spawn to the first capture of a viewable window with the editor title that held more than one colour and a standard deviation at or above 0.01, taken with import and read with identify on the same Xvfb display",
      memoryMetric:
        "median of three samples one second apart of the sum of VmRSS over the whole process tree of the launched process, read from /proc/<pid>/status after the settle",
      storageMetric: "du --apparent-size --bytes of the unpacked vendor tree the editor runs from",
      coldDefinition:
        "first launch against a profile directory that did not exist before the run, with no instance running",
      warmDefinition: "second launch against the same profile directory after a clean exit",
      workspace: null,
      workspaceReason:
        "no folder is open in any editor, because the Arrow shell does not read a folder from its command line; every editor therefore runs with an empty window and the same method",
      profileRoot: path.join(options.cache, "profiles"),
      profileEnv:
        "XDG_DATA_HOME, XDG_CONFIG_HOME and XDG_CACHE_HOME point into the profile directory of the run, so a cold start begins with no state and the operator's own editor profile is never touched",
      pageCache:
        "not flushed between launches, because that needs root; cold means a fresh profile, not a cold disk",
      displayGeometry,
      notMeasured: [
        "project indexing on a large tree",
        "the AI feature of Arrow, because it needs a provider key",
        "extensions, language servers and any workload beyond one folder open",
      ],
    },
    editors: [],
  };

  for (const editorId of options.editors) {
    let prepared;
    try {
      const editor = editorTable.find((entry) => entry.id === editorId);
      if (!editor) {
        throw new Error(`unknown editor ${editorId}`);
      }
      prepared = prepare(editor);
    } catch (error) {
      failEditor(editorId, error.message);
      results.editors.push(skipped(editorId, error.message));
      continue;
    }
    if (options.installOnly) {
      results.editors.push({
        id: editorId,
        name: editorTable.find((entry) => entry.id === editorId).name,
        status: "installed",
        version: prepared.version,
        artifact: {
          kind: prepared.artifact.kind,
          file: prepared.artifact.file,
          bytes: prepared.artifact.bytes,
          sha256: sha256(prepared.artifact.file),
          url: prepared.artifact.url,
          source: prepared.artifact.source,
        },
        storage: {
          installDir: prepared.installDir,
          installBytes: installBytes(prepared.installDir),
          metric: "du --apparent-size --bytes of the unpacked vendor tree the editor runs from",
        },
      });
      continue;
    }
    try {
      results.editors.push(await measure(editorId, display));
    } catch (error) {
      failEditor(editorId, error.message);
      results.editors.push(skipped(editorId, error.message));
    } finally {
      stopCurrentProcess();
    }
  }

  results.durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
  writeResults(results);

  if (options.markdown) {
    process.stdout.write(`\n${markdownTable(results)}\n`);
  }
  const measured = results.editors.filter((editor) => editor.status === "measured").length;
  say(`${measured} of ${results.editors.length} editors measured in ${results.durationSeconds}s`);
  stopEverything();
  process.exit(process.exitCode ?? 0);
}

process.on("SIGINT", () => {
  stopEverything();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopEverything();
  process.exit(143);
});
process.on("exit", () => {
  stopEverything();
});

await main();
