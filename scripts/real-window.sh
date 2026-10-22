#!/usr/bin/env bash
# Launches the built Arrow application in a real window and proves three things:
# the process stays alive, a window titled "Arrow" exists, and that window
# painted something that is not a blank surface.
#
# The script owns every process it starts and stops them on every exit path,
# including when an assertion fails. It starts its own Xvfb when no display is
# named, so it runs headless on a runner.
#
# Usage: scripts/real-window.sh --screenshot <path> [--display :N] [--seconds N] [--skip-build]

set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
screenshot=""
display_name=""
settle_seconds="${REAL_WINDOW_SECONDS:-8}"
window_wait_seconds="${REAL_WINDOW_WAIT_SECONDS:-40}"
skip_build=0

app_pid=""
xvfb_pid=""
work_dir=""

usage() {
  cat <<'USAGE'
Usage: scripts/real-window.sh --screenshot <path> [options]

  --screenshot <path>  where the capture of the window is written (required)
  --display <:N>       use this X display instead of starting Xvfb
  --seconds <n>        how long the process must stay alive (default 8)
  --skip-build         use the binary already in the target directory
  -h, --help           print this text
USAGE
}

fail() {
  local number="$1"
  shift
  printf 'REAL-WINDOW FAIL %s of 3: %s\n' "$number" "$*" >&2
  if [[ -n "$work_dir" && -f "$work_dir/app.log" ]]; then
    printf -- '--- application log (last 20 lines) ---\n' >&2
    tail -n 20 "$work_dir/app.log" >&2 || true
    printf -- '--- end of log ---\n' >&2
  fi
  exit 2
}

stop_process() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  set +e
  stop_process "$app_pid"
  stop_process "$xvfb_pid"
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf "$work_dir"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --screenshot)
      screenshot="${2:-}"
      shift 2
      ;;
    --display)
      display_name="${2:-}"
      shift 2
      ;;
    --seconds)
      settle_seconds="${2:-}"
      shift 2
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'real-window: unknown argument %s\n' "$1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "$screenshot" ]]; then
  printf 'real-window: --screenshot <path> is required\n' >&2
  usage >&2
  exit 64
fi
if ! [[ "$settle_seconds" =~ ^[0-9]+$ ]] || [[ "$settle_seconds" -lt 1 ]]; then
  printf 'real-window: --seconds must be a positive integer, got %s\n' "$settle_seconds" >&2
  exit 64
fi

for tool in pnpm cargo import identify python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'real-window: %s is required and is not on PATH\n' "$tool" >&2
    exit 69
  fi
done

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/arrow/cargo-target}"
binary="$CARGO_TARGET_DIR/debug/arrow-desktop"

if [[ "$skip_build" -eq 0 ]]; then
  printf 'real-window: building the web tree\n'
  if ! (cd "$root" && timeout 420 pnpm --filter @arrow/desktop build); then
    printf 'REAL-WINDOW FAIL build: the web tree did not build\n' >&2
    exit 2
  fi
  printf 'real-window: building the shell with the embedded frontend\n'
  if ! (cd "$root" && timeout 1800 cargo build \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    --features tauri/custom-protocol); then
    printf 'REAL-WINDOW FAIL build: the shell did not build\n' >&2
    exit 2
  fi
fi

if [[ ! -x "$binary" ]]; then
  printf 'REAL-WINDOW FAIL build: %s is missing, run without --skip-build\n' "$binary" >&2
  exit 2
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/arrow-real-window.XXXXXX")"

if [[ -z "$display_name" ]]; then
  command -v Xvfb >/dev/null 2>&1 || {
    printf 'real-window: Xvfb is required when no --display is named\n' >&2
    exit 69
  }
  number=99
  while [[ -e "/tmp/.X11-unix/X$number" || -e "/tmp/.X$number-lock" ]]; do
    number=$((number + 1))
    if [[ "$number" -gt 130 ]]; then
      printf 'real-window: no free display number between :99 and :130\n' >&2
      exit 69
    fi
  done
  display_name=":$number"
  setsid Xvfb "$display_name" -screen 0 1400x900x24 -nolisten tcp -ac >"$work_dir/xvfb.log" 2>&1 &
  xvfb_pid=$!
  ready=0
  for _ in $(seq 1 100); do
    if DISPLAY="$display_name" python3 -c 'import ctypes; lib = ctypes.CDLL("libX11.so.6"); lib.XOpenDisplay.restype = ctypes.c_void_p; raise SystemExit(0 if lib.XOpenDisplay(None) else 1)' >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$xvfb_pid" 2>/dev/null; then
      printf 'REAL-WINDOW FAIL display: Xvfb exited before it served %s\n' "$display_name" >&2
      tail -n 20 "$work_dir/xvfb.log" >&2 || true
      exit 2
    fi
    sleep 0.1
  done
  if [[ "$ready" -eq 0 ]]; then
    printf 'REAL-WINDOW FAIL display: Xvfb did not serve %s within 10 seconds\n' "$display_name" >&2
    exit 2
  fi
  printf 'real-window: started Xvfb on %s (pid %s)\n' "$display_name" "$xvfb_pid"
else
  printf 'real-window: using the existing display %s\n' "$display_name"
fi
export DISPLAY="$display_name"

window_query() {
  python3 - <<'PY'
import ctypes
import ctypes.util
import sys

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
    print("the X display did not open", file=sys.stderr)
    raise SystemExit(3)

root = x11.XDefaultRootWindow(display)
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
    name = property_text(window, net_wm_name, utf8)
    if name:
        return name
    return property_text(window, wm_name, xa_string)


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


matches = []
seen = []
titles = []


def walk(window, depth):
    if depth > 8:
        return
    for child in children_of(window):
        if child in seen:
            continue
        seen.append(child)
        title = title_of(child)
        attributes = XWindowAttributes()
        if not x11.XGetWindowAttributes(display, child, ctypes.byref(attributes)):
            continue
        if title:
            entry = (child, title, attributes.width, attributes.height, attributes.map_state == 2)
            titles.append(entry)
            if title == "Arrow":
                matches.append(entry)
        walk(child, depth + 1)


walk(root, 0)

if not matches:
    for window, title, width, height, viewable in titles:
        print(f"other {window} {width} {height} {'viewable' if viewable else 'hidden'} {title}", file=sys.stderr)
    raise SystemExit(1)

for window, title, width, height, viewable in matches:
    print(f"{window} {width} {height} {'viewable' if viewable else 'hidden'} {title}")
PY
}

start=$SECONDS
printf 'real-window: launching %s on %s\n' "$binary" "$display_name"
(
  cd "$root"
  exec setsid env \
    DISPLAY="$display_name" \
    GDK_BACKEND=x11 \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    LIBGL_ALWAYS_SOFTWARE=1 \
    "$binary"
) >"$work_dir/app.log" 2>&1 &
app_pid=$!

viewable_line() {
  window_query 2>/dev/null | awk '$4 == "viewable" { print; exit }'
}

deadline=$((start + window_wait_seconds))
window_line=""
while [[ "$SECONDS" -lt "$deadline" ]]; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    set +e
    wait "$app_pid"
    code=$?
    set -e
    fail 1 "the process exited with code $code before a window titled \"Arrow\" appeared"
  fi
  window_line="$(viewable_line || true)"
  if [[ -n "$window_line" ]]; then
    break
  fi
  sleep 0.25
done

elapsed=$((SECONDS - start))
if [[ "$elapsed" -lt "$settle_seconds" ]]; then
  sleep $((settle_seconds - elapsed))
fi

if ! kill -0 "$app_pid" 2>/dev/null; then
  set +e
  wait "$app_pid"
  code=$?
  set -e
  fail 1 "the process did not stay alive for $settle_seconds seconds, it exited with code $code"
fi
printf 'REAL-WINDOW PASS 1 of 3: the process stayed alive for %s seconds (pid %s)\n' "$settle_seconds" "$app_pid"

if [[ -z "$window_line" ]]; then
  window_line="$(viewable_line || true)"
fi
if [[ -z "$window_line" ]]; then
  hidden="$(window_query 2>/dev/null || true)"
  if [[ -n "$hidden" ]]; then
    window_id="$(printf '%s\n' "$hidden" | awk 'NR==1 { print $1 }')"
    window_size="$(printf '%s\n' "$hidden" | awk 'NR==1 { print $2 "x" $3 }')"
    fail 2 "the window titled \"Arrow\" exists (id $window_id, $window_size) but is not viewable"
  fi
  printf -- '--- window titles on %s ---\n' "$display_name" >&2
  window_query 2>&1 | sed 's/^/  /' >&2 || true
  printf -- '--- end of window titles ---\n' >&2
  fail 2 "no window titled \"Arrow\" exists on $display_name"
fi
window_id="$(printf '%s\n' "$window_line" | awk 'NR==1 { print $1 }')"
window_size="$(printf '%s\n' "$window_line" | awk 'NR==1 { print $2 "x" $3 }')"
window_state="$(printf '%s\n' "$window_line" | awk 'NR==1 { print $4 }')"
if [[ "$window_state" != "viewable" ]]; then
  fail 2 "the window titled \"Arrow\" exists (id $window_id, $window_size) but is not viewable"
fi
printf 'REAL-WINDOW PASS 2 of 3: a window titled "Arrow" exists (id %s, %s, %s)\n' "$window_id" "$window_size" "$window_state"

mkdir -p "$(dirname "$screenshot")"
if ! timeout 60 import -display "$display_name" -window "$window_id" "$screenshot" 2>"$work_dir/import.err"; then
  cat "$work_dir/import.err" >&2 || true
  fail 3 "the window titled \"Arrow\" could not be captured"
fi

colors="$(identify -format '%k' "$screenshot" 2>/dev/null | head -n 1)"
deviation="$(identify -format '%[fx:standard_deviation]' "$screenshot" 2>/dev/null | head -n 1)"
if [[ -z "$colors" || -z "$deviation" ]]; then
  fail 3 "the capture $screenshot could not be read"
fi
if [[ "$colors" -le 1 ]] || ! awk -v value="$deviation" 'BEGIN { exit !(value >= 0.01) }'; then
  fail 3 "the window painted a blank surface ($colors colours, standard deviation $deviation)"
fi
printf 'REAL-WINDOW PASS 3 of 3: the window painted %s colours with standard deviation %s\n' "$colors" "$deviation"
printf 'REAL-WINDOW screenshot: %s\n' "$(cd "$(dirname "$screenshot")" && pwd)/$(basename "$screenshot")"
