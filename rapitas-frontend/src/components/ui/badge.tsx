import React from 'react';

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'outline';
};

export function Badge({ className = '', variant = 'default', children, ...props }: BadgeProps) {
  const base =
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors';
  const variants = {
    default: 'bg-zinc-100 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100',
    outline: 'border border-zinc-200 text-zinc-900 dark:border-zinc-700 dark:text-zinc-100',
  };

  return (
    <span className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
}
