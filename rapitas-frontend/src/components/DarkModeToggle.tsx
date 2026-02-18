'use client';

import { useDarkMode } from '@/hooks/use-dark-mode';
import { Moon, Sun } from 'lucide-react';

export function DarkModeToggle() {
  const { isDarkMode, mounted, toggleTheme } = useDarkMode();

  if (!mounted) {
    return (
      <button
        className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        aria-label="Toggle dark mode"
      >
        <Sun className="text-gray-500" size={18} />
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      aria-label="Toggle dark mode"
    >
      {isDarkMode ? (
        <Sun className="text-gray-300" size={18} />
      ) : (
        <Moon className="text-gray-500" size={18} />
      )}
    </button>
  );
}
