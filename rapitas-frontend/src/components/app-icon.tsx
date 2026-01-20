interface AppIconProps {
  size?: number;
  className?: string;
}

export default function AppIcon({ size = 20, className = "" }: AppIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      {/* クリップボード */}
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
      {/* タスクの中身 */}
      <path
        d="M8 11h3M8 14h4"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
}
