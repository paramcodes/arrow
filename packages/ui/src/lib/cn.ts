import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names and resolve the conflicts between them.
 *
 * The primitives of this package are vendored source, so they carry Tailwind
 * classes. Two classes can reach the same property, and the later one has to
 * win, or a caller cannot override a variant.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
