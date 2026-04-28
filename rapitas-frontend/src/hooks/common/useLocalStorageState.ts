import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useLocalStorageState');

// Custom hook for optimized localStorage read/write operations
export function useLocalStorageState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  // Read from localStorage only on initial load (client-side only)
  const [state, setState] = useState<T>(() => {
    // Return default value during server-side rendering
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    try {
      const item = localStorage.getItem(key);
      return item !== null && item !== 'null' ? JSON.parse(item) : defaultValue;
    } catch (error) {
      logger.error(`Error reading localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // Re-read value from localStorage on client-side mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const timer = setTimeout(() => {
      try {
        const item = localStorage.getItem(key);
        if (item !== null && item !== 'null') {
          setState(JSON.parse(item));
        }
      } catch (error) {
        logger.error(`Error reading localStorage key "${key}" on mount:`, error);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [key]);

  // Optimize localStorage write (no debounce, immediate write)
  const setValue = useCallback(
    (value: T) => {
      try {
        setState(value);
        // Do nothing on server-side
        if (typeof window === 'undefined') return;

        if (value === null || value === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch (error) {
        logger.error(`Error saving to localStorage key "${key}":`, error);
      }
    },
    [key],
  );

  // Detect changes in other tabs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(JSON.parse(e.newValue));
        } catch (error) {
          logger.error(`Error parsing localStorage change for key "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [state, setValue];
}
