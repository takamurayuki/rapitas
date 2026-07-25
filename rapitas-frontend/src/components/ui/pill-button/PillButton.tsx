'use client';

/**
 * PillButton
 *
 * Outlined pill button with a circular icon badge and a "pressed" bottom
 * shadow that flattens on click — a distinct visual language from the plain
 * filled `Button` (components/ui/button), established by the home page's
 * task auto-execution control (AutoExecutionMode.tsx) and now the shared
 * shape for compact action buttons (task detail's execute/stop/reset/retry/
 * PR/preview-start buttons). Reuse this instead of hand-rolling the shape
 * again; extend `PillButtonColor` if a new accent is needed.
 */
import type { ComponentType, ReactNode, MouseEvent } from 'react';

export type PillButtonColor = 'indigo' | 'zinc' | 'emerald' | 'amber' | 'red';

const COLOR_CLASSES: Record<
  PillButtonColor,
  { button: string; badge: string; icon: string; plainIcon: string }
> = {
  indigo: {
    button:
      'border-indigo-300 text-indigo-600 shadow-[0_2px_0_0_#a5b4fc] hover:border-indigo-400 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:shadow-[0_2px_0_0_#312e81] dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40',
    badge: 'bg-indigo-500 dark:bg-transparent',
    icon: 'fill-white text-white dark:fill-indigo-400 dark:text-indigo-400',
    plainIcon: 'text-indigo-600 dark:text-indigo-400',
  },
  zinc: {
    button:
      'border-zinc-300 text-zinc-700 shadow-[0_2px_0_0_#d4d4d8] hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:shadow-[0_2px_0_0_#3f3f46] dark:hover:border-zinc-500 dark:hover:bg-zinc-800/60',
    badge: 'bg-zinc-500 dark:bg-transparent',
    icon: 'fill-white text-white dark:fill-zinc-400 dark:text-zinc-400',
    plainIcon: 'text-zinc-700 dark:text-zinc-300',
  },
  emerald: {
    button:
      'border-emerald-300 text-emerald-700 shadow-[0_2px_0_0_#a7f3d0] hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:shadow-[0_2px_0_0_#065f46] dark:hover:border-emerald-600 dark:hover:bg-emerald-950/40',
    badge: 'bg-emerald-500 dark:bg-transparent',
    icon: 'fill-white text-white dark:fill-emerald-400 dark:text-emerald-400',
    plainIcon: 'text-emerald-700 dark:text-emerald-400',
  },
  amber: {
    button:
      'border-amber-300 text-amber-700 shadow-[0_2px_0_0_#fcd34d] hover:border-amber-400 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:shadow-[0_2px_0_0_#78350f] dark:hover:border-amber-600 dark:hover:bg-amber-950/40',
    badge: 'bg-amber-500 dark:bg-transparent',
    icon: 'fill-white text-white dark:fill-amber-400 dark:text-amber-400',
    plainIcon: 'text-amber-700 dark:text-amber-400',
  },
  red: {
    button:
      'border-red-300 text-red-600 shadow-[0_2px_0_0_#fca5a5] hover:border-red-400 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:shadow-[0_2px_0_0_#991b1b] dark:hover:border-red-600 dark:hover:bg-red-950/40',
    badge: 'bg-red-500 dark:bg-transparent',
    icon: 'fill-white text-white dark:fill-red-400 dark:text-red-400',
    plainIcon: 'text-red-600 dark:text-red-400',
  },
};

export interface PillButtonProps {
  /** Lucide icon component shown inside the circular badge, or bare (see iconVariant). */
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  color?: PillButtonColor;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  /** Overrides the icon's color classes (e.g. a loading spinner that shouldn't be filled). */
  iconClassName?: string;
  /**
   * 'badge' (default): icon inside a colored circular badge — reserved for
   * simple, mostly-solid glyphs (Play, Square) that stay legible even
   * shrunk and white-on-color inside the badge. 'plain': bare icon in the
   * button's own accent color, no circle — for anything with finer detail
   * (arrows, curves), where the badge's small fixed circle crowded out the
   * detail regardless of icon size.
   */
  iconVariant?: 'badge' | 'plain';
}

/**
 * @param props - See {@link PillButtonProps}.
 */
export function PillButton({
  icon: Icon,
  children,
  onClick,
  color = 'indigo',
  disabled,
  title,
  ariaLabel,
  iconClassName,
  iconVariant = 'badge',
}: PillButtonProps) {
  const classes = COLOR_CLASSES[color];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`flex h-8 select-none items-center gap-1.5 rounded-lg border bg-white px-2.5 text-xs font-medium transition-colors active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 ${classes.button}`}
    >
      {iconVariant === 'badge' ? (
        // Original size (h-2 w-2) — 'badge' is now only used by Execute/Stop/
        // preview-start's Play/Square, which were confirmed fine at this size
        // (the legibility issue was specific to the detailed 'plain' icons,
        // not these simple ones — no reason to change what wasn't broken).
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${classes.badge}`}
        >
          <Icon className={`h-2 w-2 ${iconClassName ?? classes.icon}`} />
        </span>
      ) : (
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClassName ?? classes.plainIcon}`} />
      )}
      {children}
    </button>
  );
}
