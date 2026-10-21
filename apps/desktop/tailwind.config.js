/**
 * The Tailwind source discovery of the desktop shell.
 *
 * Tailwind v4 collects the utility classes from the files it scans, and by
 * default the scan reaches only the directory of the CSS entry point. The
 * shell renders the primitives of `packages/ui`, so those files have to be
 * scanned too. Without them every utility a primitive uses is missing from
 * the bundle: the resize handle loses its width, the panels lose their
 * layout, and the primitive renders unstyled.
 *
 * The list below is the whole set of files that may hold a utility class. A
 * new package that ships utility classes belongs in it. The proof case "the
 * tailwind build scans the shared ui package" fails when a package that
 * ships utility classes is missing from the list.
 *
 * The paths are relative to the directory of this file, which is the
 * directory the app build runs in.
 */
export default {
  content: ["./src/**/*.{ts,tsx}", "../../packages/*/src/**/*.{ts,tsx}"],
};
