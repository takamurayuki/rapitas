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
 * Same artwork as the desktop / mobile app icons. The geometry is the
 * small-size master (`rapitas-desktop/src-tauri/icons/app-icon-small.svg`),
 * because the web UI only ever shows this icon at header size (~32px), where
 * the full-size artwork's thin rows run together.
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
      <g transform="rotate(-6 512 512)" fill="#FFFFFF">
        {/* Row 1: box + dash */}
        <path d="M180 180L280 180A30 30 0 0 1 310 210L310 310A30 30 0 0 1 280 340L180 340A30 30 0 0 1 150 310L150 210A30 30 0 0 1 180 180Z" />
        <path d="M402 180L729.8 180L815 310A30 30 0 0 1 785 340L402 340A30 30 0 0 1 372 310L372 210A30 30 0 0 1 402 180Z" />
        {/* Row 2 */}
        <path d="M180 432L280 432A30 30 0 0 1 310 462L310 562A30 30 0 0 1 280 592L180 592A30 30 0 0 1 150 562L150 462A30 30 0 0 1 180 432Z" />
        <path d="M402 432L799.8 432L885 562A30 30 0 0 1 855 592L402 592A30 30 0 0 1 372 562L372 462A30 30 0 0 1 402 432Z" />
        {/* Row 3 */}
        <path d="M180 684L280 684A30 30 0 0 1 310 714L310 814A30 30 0 0 1 280 844L180 844A30 30 0 0 1 150 814L150 714A30 30 0 0 1 180 684Z" />
        <path d="M402 684L634.8 684L720 814A30 30 0 0 1 690 844L402 844A30 30 0 0 1 372 814L372 714A30 30 0 0 1 402 684Z" />
      </g>
    </svg>
  );
}
