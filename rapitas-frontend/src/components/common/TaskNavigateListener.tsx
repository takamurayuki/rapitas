'use client';

/**
 * TaskNavigateListener
 *
 * Main-window listener for cross-window task navigation: popup windows (the
 * Pomodoro float's task-title link) invoke the `open_task_in_main` Tauri
 * command, which fronts the main window and emits `rapitas:navigate-task`
 * with a task id — this component routes to that task's detail page.
 * Rendered inside MainWindowOnly so popups never react to it themselves.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function TaskNavigateListener() {
  const router = useRouter();

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<number>('rapitas:navigate-task', (event) => {
        const taskId = Number(event.payload);
        if (Number.isFinite(taskId) && taskId > 0) router.push(`/tasks/${taskId}`);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, [router]);

  return null;
}
