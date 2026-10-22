# How the performance table was measured

Every number in the performance table of the README was measured by `scripts/perf-compare.mjs` on
one machine, on one day, with one method. No number comes from a vendor page, a blog post, a forum
thread or a package listing. The raw output of the run is
[`results.json`](results.json), and it carries the machine, the method, the artifacts and the date
beside the numbers.

## Rerun it

```bash
node scripts/perf-compare.mjs
node scripts/perf-compare.mjs --markdown
```

The Markdown mode prints the table the README carries, computed from the results of that run, so the
README and the data file cannot drift apart by hand.

The script needs `Xvfb`, `import` and `identify` from ImageMagick, `python3` with libX11, `curl`,
`tar` and `du`. The Arrow row needs the built application. When no bundle exists the script builds
one with `pnpm --filter @arrow/desktop tauri build --bundles appimage`, and `--arrow-appimage <file>`
points it at an artifact that was built elsewhere, such as the AppImage of a release.

Useful flags:

- `--editors arrow,vscode,cursor` measures a subset.
- `--settle <seconds>` changes the idle wait before the memory sample.
- `--install-only` fetches, unpacks and measures storage without launching anything.
- `--display :N` uses an existing display instead of starting Xvfb.
- `--no-download` and `--no-build` fail instead of fetching or building anything.

The vendor artifacts are fetched once into `~/.cache/arrow/perf/editors`, outside the repository,
and unpacked into `~/.cache/arrow/perf/installs`. The repository holds no downloaded binary.

## The artifacts

| Editor | Version | Artifact | Where it came from |
| --- | --- | --- | --- |
| Arrow | 0.5.0 | `Arrow_0.5.0_amd64.AppImage`, 82,840,056 bytes | The published release, `https://github.com/paramcodes/arrow/releases/download/v0.5.0/Arrow_0.5.0_amd64.AppImage`, with the SHA-256 the release body states |
| VS Code | 1.143.0 | `code-stable-x64-1792533330.tar.gz` | `https://code.visualstudio.com/sha/download?build=stable&os=linux-x64`, the vendor's Linux x64 archive |
| Cursor | 3.26.16 | `Cursor-3.26.16-x86_64.AppImage` | `https://www.cursor.com/api/download?platform=linux-x64&releaseTrack=stable`, the URL the vendor's download API answers with |

Each artifact is unpacked, and the editor runs from the unpacked tree. Install size is the apparent
size of that tree, measured with `du --apparent-size --bytes`, because that is what the editor
occupies on disk after the install the vendor ships. The size of the artifact file itself is in
`results.json` under `artifact.bytes`.

The Arrow artifact is the AppImage the `v0.5.0` release publishes. The VS Code and Cursor artifacts
are fetched from the vendor on the day of the run, so a rerun on another day measures whatever
version is current then, and `results.json` records the version that was measured.

## What each column means

- **Idle memory, warm launch, process tree (MiB).** The sum of `VmRSS` over every process descended from the
  launched process, read from `/proc/<pid>/status`. For an Electron editor that is the browser
  process, the renderer, the GPU process and the utility processes. The sample is taken 25 seconds
  after the window painted, three times one second apart, and the median is reported. `VmRSS` counts
  a shared page once per process, so the sum over-counts memory the processes share. All three
  editors are over-counted the same way.
- **Cold start to first paint (ms).** Milliseconds from the spawn to the first capture of a viewable
  window with the editor's title that held more than one colour and a standard deviation at or above
  0.01. The window is found by walking the X tree with libX11, the capture is taken with `import`,
  and the pixels are read with `identify`. A window that only mapped a blank surface does not stop
  the clock. The capture and the check add their own duration to the number, by the same amount for
  every editor.
- **Warm start to first paint (ms).** The same measurement on the second launch against the same
  profile directory, after the first process tree exited.
- **Install on disk (MiB).** The apparent size of the unpacked vendor tree the editor runs from.

## How each launch was made the same

All three editors ran on one private Xvfb display at 1280x800x24, with
`XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` pointing into a profile directory of the
run. A cold start begins with that directory removed, so neither the operator's own profile nor a
previous run can be touched. The Electron editors also received `--user-data-dir`,
`--extensions-dir`, `--no-sandbox` and `--ozone-platform=x11`, and `WAYLAND_DISPLAY` was removed
from the environment so the window lands on X11 rather than on the Wayland session of the machine.

No folder is open in any editor. Arrow's shell does not read a folder from its command line, so
opening one for VS Code and Cursor alone would compare different windows. Every editor therefore
runs with an empty window, and the numbers are the smallest idle footprint each can show.

## The machine

- Intel Core i3-4005U, four threads, at 1.70 GHz
- 7.6 GiB of RAM
- Omarchy, kernel 7.2.8, a Wayland session with Hyprland
- A private Xvfb display at 1280x800x24, software rendering, with no compositor and no GPU
- 22 October 2026

`results.json` records the machine it measured on, so a rerun elsewhere writes its own facts.

## What the table does not cover

- A page cache flush between launches. That needs root, so the cold start means a fresh profile,
  not a cold disk. Both launches of an editor read files the first launch already read.
- Project indexing. No folder is open, so no editor indexed a tree.
- Any workload beyond an idle window. No typing, no search, no terminal, no git status.
- The AI features of Arrow. They need a provider key, and the key lives in the OS keychain and never
  in the webview, so the script makes no provider call.
- Extensions, language servers, multi-cursor and remote development. Arrow has none of them yet,
  and the table is not a feature comparison. It measures cost, and it does not rank the editors.
- Repeats. One cold and one warm launch per editor per run. A rerun is the way to see the spread.

## Why the numbers can move between runs

Startup and idle memory depend on what else the machine is doing, on the page cache, and on the
thermal state of a four-thread laptop processor. The script writes one launch per state, and the
spread between two runs was wide enough to see in the Arrow row: the cold start of VS Code measured
36 seconds on the first run of the day and 12 seconds on the second, a difference of page cache
alone. Read the table as the cost of an idle editor on this machine, not as a ranking, and rerun it
to see the spread.
