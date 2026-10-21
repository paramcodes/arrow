import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/cn";

/**
 * The button variants of Arrow.
 *
 * Every color is a token of `@arrow/theme`. An IDE is dense, so the sizes stay
 * small and the corners are barely rounded.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm text-xs font-medium whitespace-nowrap transition-colors select-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-canvas-strong hover:bg-accent-hover",
        ghost: "text-ink-secondary hover:bg-surface-hover hover:text-ink",
        outline: "border border-border-strong bg-transparent text-ink hover:bg-surface-hover",
      },
      size: {
        sm: "h-6 px-2",
        md: "h-7 px-2.5",
        icon: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

/** The props of a button. */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

/**
 * A button. The variants carry the colors, so a caller never names one.
 */
export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} type={type} {...props} />
  );
}
