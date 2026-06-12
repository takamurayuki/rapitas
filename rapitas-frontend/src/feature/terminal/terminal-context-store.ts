/**
 * terminal-context-store
 *
 * Holds the "working directory the next terminal should open in", set by the
 * current view (task list → selected theme's dir, task detail → that task's
 * dir) and consumed by the terminal store's open() so Ctrl+J lands in the
 * right directory.
 */
import { create } from 'zustand';

interface TerminalContextState {
  cwd: string | null;
  title: string | null;
  setTerminalContext: (ctx: { cwd: string | null; title?: string | null }) => void;
}

export const useTerminalContextStore = create<TerminalContextState>((set) => ({
  cwd: null,
  title: null,
  setTerminalContext: ({ cwd, title }) => set({ cwd, title: title ?? null }),
}));

/** Non-reactive snapshot for the terminal store's open() logic. */
export function getTerminalContext(): { cwd: string | null; title: string | null } {
  const { cwd, title } = useTerminalContextStore.getState();
  return { cwd, title };
}
