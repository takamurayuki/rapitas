/**
 * AppIcon
 *
 * Draws the Rapi+ app icon for the web UI (header logo next to the "Rapi+" wordmark).
 * Not the favicon or the desktop/mobile bundle icons, which are image files.
 */
import { useId } from 'react';

interface AppIconProps {
  size?: number;
  className?: string;
}

/**
 * The Rapi+ app icon: the task-dash mark (three task rows, each a check box
 * and a dash) in white on the brand violet→indigo rounded square.
 *
 * Same artwork and composition as the desktop app icon
 * (`rapitas-desktop/src-tauri/icons/app-icon.svg`): the tile, the -10° tilt and
 * the six row paths are copied verbatim from it, so the header logo matches the
 * desktop and mobile app icons. AppIcon.test checks the two stay identical.
 *
 * Draws its own background, so callers place it directly rather than inside a
 * coloured tile.
 */
export default function AppIcon({ size = 32, className = '' }: AppIconProps) {
  // Several icons can be on one page; each needs its own gradient id.
  const gradientId = `app-icon-bg-${useId().replace(/:/g, '')}`;
  return (
    <svg
      data-testid="app-icon"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="213" fill={`url(#${gradientId})`} />
      <g transform="rotate(-10 512 512)" fill="#FFFFFF">
        {/* Row 1: box + dash */}
        <path d="M205 266 L277 266 A15 15 0 0 1 292 281 L292 353 A15 15 0 0 1 277 368 L205 368 A15 15 0 0 1 190 353 L190 281 A15 15 0 0 1 205 266 Z" />
        <path d="M358 266 L673.49 266 A15 15 0 0 1 686.37 273.3 L729.43 345.3 A15 15 0 0 1 716.55 368 L358 368 A15 15 0 0 1 343 353 L343 281 A15 15 0 0 1 358 266 Z" />
        {/* Row 2 */}
        <path d="M205 461 L277 461 A15 15 0 0 1 292 476 L292 548 A15 15 0 0 1 277 563 L205 563 A15 15 0 0 1 190 548 L190 476 A15 15 0 0 1 205 461 Z" />
        <path d="M358 461 L775.49 461 A15 15 0 0 1 788.37 468.3 L831.43 540.3 A15 15 0 0 1 818.55 563 L358 563 A15 15 0 0 1 343 548 L343 476 A15 15 0 0 1 358 461 Z" />
        {/* Row 3 */}
        <path d="M205 656 L277 656 A15 15 0 0 1 292 671 L292 743 A15 15 0 0 1 277 758 L205 758 A15 15 0 0 1 190 743 L190 671 A15 15 0 0 1 205 656 Z" />
        <path d="M358 656 L621.49 656 A15 15 0 0 1 634.37 663.3 L677.43 735.3 A15 15 0 0 1 664.55 758 L358 758 A15 15 0 0 1 343 743 L343 671 A15 15 0 0 1 358 656 Z" />
      </g>
    </svg>
  );
}
