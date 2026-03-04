import React from 'react';

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
};

export function Progress({
  className = '',
  value = 0,
  max = 100,
  ...props
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 ${className}`}
      {...props}
    >
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
