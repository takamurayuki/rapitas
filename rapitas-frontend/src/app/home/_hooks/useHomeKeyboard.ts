'use client';
// useHomeKeyboard
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface UseHomeKeyboardParams {
  isQuickAdding: boolean;
  isSelectionMode: boolean;
  themeFilter: number | null;
  defaultThemeId: number | undefined;
  setIsQuickAdding: (v: boolean) => void;
  setIsSelectionMode: (fn: (prev: boolean) => boolean) => void;
  setSelectedTasks: (tasks: Set<number>) => void;
  setQuickTaskTitle: (v: string) => void;
}

/**
 * Attaches home page keyboard shortcuts to the window.
 *
 * @param params - State values and setters needed by the shortcut handlers.
 */
export function useHomeKeyboard({
  isQuickAdding,
  isSelectionMode,
  themeFilter,
  defaultThemeId,
  setIsQuickAdding,
  setIsSelectionMode,
  setSelectedTasks,
  setQuickTaskTitle,
}: UseHomeKeyboardParams) {
  const router = useRouter();

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'n': {
            e.preventDefault();
            const themeParam = themeFilter || defaultThemeId;
            router.push(`/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`);
            break;
          }
          case 'q':
            e.preventDefault();
            setIsQuickAdding(true);
            break;
          case 's':
            e.preventDefault();
            setIsSelectionMode((prev) => !prev);
            if (isSelectionMode) setSelectedTasks(new Set());
            break;
        }
      } else if (e.key === 'Escape' && isQuickAdding) {
        setIsQuickAdding(false);
        setQuickTaskTitle('');
      }
    };

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [
    router,
    isQuickAdding,
    isSelectionMode,
    themeFilter,
    defaultThemeId,
    setIsQuickAdding,
    setIsSelectionMode,
    setSelectedTasks,
    setQuickTaskTitle,
  ]);
}
