import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

interface DarkModeReturn {
  theme: Theme;
  isDarkMode: boolean;
  mounted: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export function useDarkMode(): DarkModeReturn {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  const isDarkMode = theme === 'dark';

  useEffect(() => {
    const timer = setTimeout(() => {
      const storedTheme =
        typeof window !== 'undefined' ? window.localStorage?.getItem('theme') : null;
      const prefersDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;

      if (storedTheme === 'light' || storedTheme === 'dark') {
        setThemeState(storedTheme);
      } else if (prefersDark) {
        setThemeState('dark');
      }
      setMounted(true);
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = window.document.documentElement;
    root.classList.remove(isDarkMode ? 'light' : 'dark');
    root.classList.add(theme);
    window.localStorage?.setItem('theme', theme);
  }, [theme, isDarkMode, mounted]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return { theme, isDarkMode, mounted, toggleTheme, setTheme };
}
