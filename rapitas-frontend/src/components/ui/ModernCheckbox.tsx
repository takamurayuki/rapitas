'use client';
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModernCheckboxProps {
  checked: boolean;
  onChange: () => void;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

export const ModernCheckbox: React.FC<ModernCheckboxProps> = ({
  checked,
  onChange,
  onClick,
  className = '',
}) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        if (onClick) onClick(e);
        onChange();
      }}
      className={`
        relative w-6 h-6 rounded-lg
        border-2 border-slate-300 dark:border-slate-600
        bg-white dark:bg-slate-900
        transition-all duration-300 ease-out
        hover:border-purple-400 dark:hover:border-purple-500
        hover:shadow-[0_0_0_3px_rgba(168,85,247,0.1)] dark:hover:shadow-[0_0_0_3px_rgba(168,85,247,0.2)]
        hover:scale-110
        focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-0
        ${checked ? 'border-purple-500 dark:border-purple-400 bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-400 dark:to-purple-500' : ''}
        ${className}
      `}
    >
      <AnimatePresence>
        {checked && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 17,
            }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <svg
              className="w-3.5 h-3.5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <motion.path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ホバー時のリップル効果 */}
      <span
        className={`
          absolute inset-0 rounded-lg
          ${checked ? 'bg-purple-600/20' : 'bg-purple-500/10'}
          opacity-0 hover:opacity-100
          transition-opacity duration-300
          pointer-events-none
        `}
      />
    </button>
  );
};