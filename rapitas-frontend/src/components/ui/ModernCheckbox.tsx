'use client';
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModernCheckboxProps {
  checked: boolean;
  onChange: () => void;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  'aria-label'?: string;
}

export const ModernCheckbox: React.FC<ModernCheckboxProps> = ({
  checked,
  onChange,
  onClick,
  className = '',
  'aria-label': ariaLabel,
}) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (onClick) onClick(e);
        onChange();
      }}
      className={`
        relative w-6 h-6 rounded-lg
        border-2
        transition-all duration-300 ease-out
        hover:border-indigo-400 dark:hover:border-indigo-500
        hover:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] dark:hover:shadow-[0_0_0_3px_rgba(99,102,241,0.2)]
        hover:scale-110
        focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-0
        ${
          checked
            ? // Light indigo fill + indigo border. The check itself is indigo
              // (not white) so it stays visible against the light/white card.
              // Background is fully conditional to avoid a bg-white vs bg-indigo
              // Tailwind conflict that previously left the box white.
              'border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
        }
        ${className}
      `}
    >
      {/* NOTE: keyed child + a statically-drawn check path. The previous version
          animated `pathLength` from 0→1 inside an unkeyed AnimatePresence, which
          could leave the stroke stuck at length 0 (invisible checkmark) when the
          parent re-rendered — the checkbox then looked empty while checked. The
          check is now always drawn when `checked`; only the container pops in. */}
      <AnimatePresence initial={false}>
        {checked && (
          <motion.div
            key="checkmark"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 17,
            }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <svg
              className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover ripple effect */}
      <span
        className={`
          absolute inset-0 rounded-lg
          ${checked ? 'bg-indigo-600/20' : 'bg-indigo-500/10'}
          opacity-0 hover:opacity-100
          transition-opacity duration-300
          pointer-events-none
        `}
      />
    </button>
  );
};
