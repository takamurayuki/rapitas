"use client";

import { useDarkMode } from "@/hooks/use-dark-mode";
import { Moon, Sun } from "lucide-react";

export function DarkModeToggle() {
  const { isDarkMode, toggleTheme } = useDarkMode();

  return (
    <button
      onClick={toggleTheme}
      className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      aria-label="Toggle dark mode"
    >
      {isDarkMode ? (
        <Moon className="text-yellow-300" size={18} />
      ) : (
        <Sun className="text-gray-500" size={18} />
      )}
    </button>
  );
}
