# The clips of the features

Every clip in this folder is a recording of the built Arrow desktop application, not of the browser
build. `scripts/record-demo.mjs` starts the shell on its own virtual display, generates a workspace,
drives the window with synthetic X input and captures the display with ffmpeg.

The AI clips talk to `scripts/mock-ai-server.mjs`, a local stand-in for the provider API that
answers with a canned completion or a canned inline edit. No key is used, no account is involved
and no provider is called. The recorder writes a dummy string through the real settings dialog so
the status bar leaves its "no key" state, and it removes that string again unless a key was already
in the keychain before the run.

## Rerun it

```bash
pnpm --filter @arrow/desktop build
node scripts/record-demo.mjs
```

The script builds the web tree and the shell itself unless `--skip-build` is given. It needs
`Xvfb`, `ffmpeg`, `python3`, `secret-tool` and the shared cargo target directory
`~/.cache/arrow/cargo-target`. Options:

- `--only clip,clip` records a subset.
- `--skip-build` uses the binary already in the cargo target directory.
- `--keep` keeps the run directory, which holds the mp4 captures and the logs.

The recorder owns every process it starts, including Xvfb, the stand-in and the application, and it
stops them on success, on failure and on a signal.

## The workspace

Each clip gets a fresh folder under the system temporary directory, with a git repository on the
branch `demo` and one modified, one untracked and one deleted file so the badges and the status bar
have something to show. The folder is removed when the clip ends, so the repository holds no
scratch tree and `git status` is clean apart from the media the run writes.

## The input

`xdotool` is not installed on this machine and installing it is not an option, so
`scripts/demo/x11-input.py` drives the window through `libX11` and `libXtst` with `ctypes`. It
finds a window by title, focuses it, and sends a chord, a string, a click or a pointer move. The
recorder clicks twice where the first click only takes focus under Xvfb, and the folder picker is
opened with `Ctrl+O` and confirmed through its own dialog.

## The clips

| Feature | Clip |
| --- | --- |
| A fresh window, before a folder is open | [first-run.gif](first-run.gif) |
| The tree follows the disk | [tree-follows-disk.gif](tree-follows-disk.gif) |
| Tabs, the dirty marker and `Ctrl+S` | [editor-tabs.gif](editor-tabs.gif) |
| Ghost text, taken with `Tab` | [ghost-text.gif](ghost-text.gif) |
| The inline edit as a diff, taken with `Ctrl+Enter` | [inline-edit.gif](inline-edit.gif) |
| The model and the key in the settings | [settings-model.gif](settings-model.gif) |
| A terminal on a real PTY | [terminal.gif](terminal.gif) |
| Git badges in the tree and the status bar | [git-badges.gif](git-badges.gif) |
| The command palette | [command-palette.gif](command-palette.gif) |
| The project search | [project-search.gif](project-search.gif) |
| The settings dialog, and the value it stores | [settings-dialog.gif](settings-dialog.gif) |

The whole media set, the clips and the stills in `docs/images/`, is under three megabytes.
