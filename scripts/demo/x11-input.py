#!/usr/bin/env python3
"""Send synthetic input to a window on an X display, with libX11 and libXtst.

`xdotool` is not on the machine, and installing it needs sudo, so the demo
recorder drives the real window through the two libraries the X server already
ships. Both are loaded with `ctypes`: libX11 finds the window and owns the
keyboard mapping, libXtst sends the key and button events.

Every command names the display with `--display` and the window by title with
`--window`. A window that is not found is an error with the titles that do
exist, so a renamed window fails loudly instead of driving the wrong surface.

Usage:
  x11-input.py --display :99 windows
  x11-input.py --display :99 --window Arrow focus
  x11-input.py --display :99 --window Arrow key ctrl+shift+p
  x11-input.py --display :99 --window Arrow type "hello"
  x11-input.py --display :99 --window Arrow click 120 240
  x11-input.py --display :99 --window Arrow move 120 240
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import sys
import time

Window = ctypes.c_ulong
Atom = ctypes.c_ulong
Bool = ctypes.c_int

X11 = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
XTST = ctypes.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")


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


X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XCloseDisplay.argtypes = [ctypes.c_void_p]
X11.XDefaultRootWindow.restype = Window
X11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
X11.XQueryTree.argtypes = [
    ctypes.c_void_p,
    Window,
    ctypes.POINTER(Window),
    ctypes.POINTER(Window),
    ctypes.POINTER(ctypes.POINTER(Window)),
    ctypes.POINTER(ctypes.c_uint),
]
X11.XQueryTree.restype = ctypes.c_int
X11.XInternAtom.restype = Atom
X11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, Bool]
X11.XGetWindowProperty.argtypes = [
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
X11.XGetWindowProperty.restype = ctypes.c_int
X11.XGetWindowAttributes.argtypes = [ctypes.c_void_p, Window, ctypes.POINTER(XWindowAttributes)]
X11.XGetWindowAttributes.restype = ctypes.c_int
X11.XFree.argtypes = [ctypes.c_void_p]
X11.XSetInputFocus.argtypes = [ctypes.c_void_p, Window, ctypes.c_int, ctypes.c_ulong]
X11.XSetInputFocus.restype = ctypes.c_int
X11.XRaiseWindow.argtypes = [ctypes.c_void_p, Window]
X11.XRaiseWindow.restype = ctypes.c_int
X11.XTranslateCoordinates.argtypes = [
    ctypes.c_void_p,
    Window,
    Window,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(Window),
]
X11.XTranslateCoordinates.restype = ctypes.c_int
X11.XStringToKeysym.argtypes = [ctypes.c_char_p]
X11.XStringToKeysym.restype = ctypes.c_ulong
X11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X11.XKeysymToKeycode.restype = ctypes.c_ubyte
X11.XkbKeycodeToKeysym.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, ctypes.c_int, ctypes.c_int]
X11.XkbKeycodeToKeysym.restype = ctypes.c_ulong
X11.XFlush.argtypes = [ctypes.c_void_p]
X11.XSync.argtypes = [ctypes.c_void_p, Bool]

XTST.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, Bool, ctypes.c_ulong]
XTST.XTestFakeKeyEvent.restype = ctypes.c_int
XTST.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, Bool, ctypes.c_ulong]
XTST.XTestFakeButtonEvent.restype = ctypes.c_int
XTST.XTestFakeMotionEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_ulong,
]
XTST.XTestFakeMotionEvent.restype = ctypes.c_int

RevertToParent = 2
CurrentTime = 0
XA_STRING = 31


class Display:
    """One connection to one X display."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.display = X11.XOpenDisplay(name.encode())
        if not self.display:
            raise SystemExit(f"x11-input: the display {name} did not open")
        self.root = X11.XDefaultRootWindow(self.display)
        self.utf8 = X11.XInternAtom(self.display, b"UTF8_STRING", 0)
        self.net_wm_name = X11.XInternAtom(self.display, b"_NET_WM_NAME", 0)
        self.wm_name = X11.XInternAtom(self.display, b"WM_NAME", 0)

    def close(self) -> None:
        X11.XCloseDisplay(self.display)

    def _text(self, window: Window, prop: Atom, prop_type: Atom) -> str | None:
        actual_type = Atom()
        actual_format = ctypes.c_int()
        items = ctypes.c_ulong()
        after = ctypes.c_ulong()
        data = ctypes.POINTER(ctypes.c_ubyte)()
        status = X11.XGetWindowProperty(
            self.display,
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
            X11.XFree(data)

    def title_of(self, window: Window) -> str:
        return (
            self._text(window, self.net_wm_name, self.utf8)
            or self._text(window, self.wm_name, XA_STRING)
            or ""
        )

    def children_of(self, window: Window) -> list[Window]:
        root_return = Window()
        parent_return = Window()
        children = ctypes.POINTER(Window)()
        count = ctypes.c_uint()
        if not X11.XQueryTree(
            self.display,
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
                X11.XFree(children)

    def windows(self) -> list[tuple[Window, str, int, int, bool]]:
        found: list[tuple[Window, str, int, int, bool]] = []
        seen: list[Window] = []

        def walk(window: Window, depth: int) -> None:
            if depth > 8:
                return
            for child in self.children_of(window):
                if child in seen:
                    continue
                seen.append(child)
                title = self.title_of(child)
                attributes = XWindowAttributes()
                if X11.XGetWindowAttributes(self.display, child, ctypes.byref(attributes)):
                    if title:
                        found.append(
                            (
                                child,
                                title,
                                attributes.width,
                                attributes.height,
                                attributes.map_state == 2,
                            )
                        )
                    walk(child, depth + 1)

        walk(self.root, 0)
        return found

    def find(self, title: str) -> Window:
        matches = [entry for entry in self.windows() if entry[1] == title and entry[4]]
        if not matches:
            titles = sorted({entry[1] for entry in self.windows()})
            raise SystemExit(f"x11-input: no viewable window titled {title!r}; titles: {titles}")
        # The last match is the deepest window of that title, which is the one
        # that takes input when a title is reused inside a dialog.
        return matches[-1][0]

    def focus(self, window: Window) -> None:
        X11.XRaiseWindow(self.display, window)
        X11.XSetInputFocus(self.display, window, RevertToParent, CurrentTime)
        X11.XSync(self.display, 0)

    def origin(self, window: Window) -> tuple[int, int, int, int]:
        x = ctypes.c_int()
        y = ctypes.c_int()
        child = Window()
        if not X11.XTranslateCoordinates(
            self.display, window, self.root, 0, 0, ctypes.byref(x), ctypes.byref(y), ctypes.byref(child)
        ):
            raise SystemExit("x11-input: the window has no place on the root")
        attributes = XWindowAttributes()
        X11.XGetWindowAttributes(self.display, window, ctypes.byref(attributes))
        return x.value, y.value, attributes.width, attributes.height

    def keycode(self, keysym: int) -> int:
        return X11.XKeysymToKeycode(self.display, keysym)

    def press(self, keycode: int, shift: bool) -> None:
        shift_code = self.keycode(X11.XStringToKeysym(b"Shift_L"))
        if shift:
            XTST.XTestFakeKeyEvent(self.display, shift_code, 1, CurrentTime)
        XTST.XTestFakeKeyEvent(self.display, keycode, 1, CurrentTime)
        XTST.XTestFakeKeyEvent(self.display, keycode, 0, CurrentTime)
        if shift:
            XTST.XTestFakeKeyEvent(self.display, shift_code, 0, CurrentTime)
        X11.XFlush(self.display)
        time.sleep(0.03)

    def key(self, name: str) -> None:
        """Press one key or one chord, such as `ctrl+shift+p` or `Return`."""
        parts = name.split("+")
        key_name = parts[-1]
        modifiers = {part.lower() for part in parts[:-1]}
        unknown = modifiers - {"ctrl", "control", "shift", "alt", "super"}
        if unknown:
            raise SystemExit(f"x11-input: unknown modifier in {name!r}")
        keysym = X11.XStringToKeysym(key_name.encode())
        if keysym == 0:
            raise SystemExit(f"x11-input: unknown key {key_name!r}")
        keycode = self.keycode(keysym)
        if keycode == 0:
            raise SystemExit(f"x11-input: no keycode for {key_name!r}")

        modifier_codes = []
        for modifier, keysym_name in (
            ("ctrl", b"Control_L"),
            ("control", b"Control_L"),
            ("shift", b"Shift_L"),
            ("alt", b"Alt_L"),
            ("super", b"Super_L"),
        ):
            if modifier in modifiers:
                code = self.keycode(X11.XStringToKeysym(keysym_name))
                if code:
                    modifier_codes.append(code)
        modifier_codes = list(dict.fromkeys(modifier_codes))

        for code in modifier_codes:
            XTST.XTestFakeKeyEvent(self.display, code, 1, CurrentTime)
        XTST.XTestFakeKeyEvent(self.display, keycode, 1, CurrentTime)
        XTST.XTestFakeKeyEvent(self.display, keycode, 0, CurrentTime)
        for code in reversed(modifier_codes):
            XTST.XTestFakeKeyEvent(self.display, code, 0, CurrentTime)
        X11.XFlush(self.display)
        time.sleep(0.03)

    def type_text(self, text: str) -> None:
        """Type text one character at a time, with shift when the key needs it."""
        names = {
            " ": "space",
            "\n": "Return",
            "\t": "Tab",
            "!": "exclam",
            '"': "quotedbl",
            "#": "numbersign",
            "$": "dollar",
            "%": "percent",
            "&": "ampersand",
            "'": "apostrophe",
            "(": "parenleft",
            ")": "parenright",
            "*": "asterisk",
            "+": "plus",
            ",": "comma",
            "-": "minus",
            ".": "period",
            "/": "slash",
            ":": "colon",
            ";": "semicolon",
            "<": "less",
            "=": "equal",
            ">": "greater",
            "?": "question",
            "@": "at",
            "[": "bracketleft",
            "\\": "backslash",
            "]": "bracketright",
            "^": "asciicircum",
            "_": "underscore",
            "`": "grave",
            "{": "braceleft",
            "|": "bar",
            "}": "braceright",
            "~": "asciitilde",
        }
        for character in text:
            name = names.get(character, character)
            keysym = X11.XStringToKeysym(name.encode())
            if keysym == 0:
                raise SystemExit(f"x11-input: no keysym for {character!r}")
            keycode = self.keycode(keysym)
            if keycode == 0:
                raise SystemExit(f"x11-input: no keycode for {character!r}")
            base = X11.XkbKeycodeToKeysym(self.display, keycode, 0, 0)
            shift = base != keysym
            if shift and character.isalpha() and character.islower():
                shift = False
            self.press(keycode, shift)

    def click(self, x: int, y: int) -> None:
        XTST.XTestFakeMotionEvent(self.display, -1, x, y, CurrentTime)
        X11.XFlush(self.display)
        time.sleep(0.05)
        XTST.XTestFakeButtonEvent(self.display, 1, 1, CurrentTime)
        XTST.XTestFakeButtonEvent(self.display, 1, 0, CurrentTime)
        X11.XFlush(self.display)
        time.sleep(0.02)

    def move(self, x: int, y: int) -> None:
        XTST.XTestFakeMotionEvent(self.display, -1, x, y, CurrentTime)
        X11.XFlush(self.display)
        time.sleep(0.02)


def main() -> int:
    parser = argparse.ArgumentParser(description="Send synthetic input to an X window")
    parser.add_argument("--display", default=":99")
    parser.add_argument("--window", default=None)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("windows")
    sub.add_parser("focus")
    key_parser = sub.add_parser("key")
    key_parser.add_argument("chord")
    type_parser = sub.add_parser("type")
    type_parser.add_argument("text")
    click_parser = sub.add_parser("click")
    click_parser.add_argument("x", type=int)
    click_parser.add_argument("y", type=int)
    click_parser.add_argument("--relative", action="store_true", help="coordinates are window relative")
    move_parser = sub.add_parser("move")
    move_parser.add_argument("x", type=int)
    move_parser.add_argument("y", type=int)
    sub.add_parser("geometry")

    args = parser.parse_args()
    display = Display(args.display)
    try:
        if args.command == "windows":
            for window, title, width, height, viewable in display.windows():
                print(f"{window} {width} {height} {'viewable' if viewable else 'hidden'} {title}")
            return 0

        if args.window is None:
            raise SystemExit("x11-input: --window <title> is required for this command")
        window = display.find(args.window)

        if args.command == "focus":
            display.focus(window)
        elif args.command == "geometry":
            origin_x, origin_y, width, height = display.origin(window)
            print(f"{window} {origin_x} {origin_y} {width} {height}")
        elif args.command == "key":
            display.focus(window)
            display.key(args.chord)
        elif args.command == "type":
            display.focus(window)
            display.type_text(args.text)
        elif args.command == "move":
            origin_x, origin_y, _width, _height = display.origin(window)
            display.focus(window)
            display.move(origin_x + args.x, origin_y + args.y)
        elif args.command == "click":
            if not args.relative:
                raise SystemExit("x11-input: click needs --relative for now")
            origin_x, origin_y, width, height = display.origin(window)
            if not (0 <= args.x < width and 0 <= args.y < height):
                raise SystemExit(
                    f"x11-input: {args.x},{args.y} is outside the {width}x{height} window"
                )
            display.focus(window)
            display.click(origin_x + args.x, origin_y + args.y)
        return 0
    finally:
        display.close()


if __name__ == "__main__":
    sys.exit(main())
