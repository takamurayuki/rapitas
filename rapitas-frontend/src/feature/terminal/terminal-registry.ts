/**
 * terminal-registry
 *
 * Module-level map of live xterm instances keyed by session id, so the panel
 * can focus a specific terminal (e.g. the leftmost pane when the dock opens)
 * without prop-drilling refs through the component tree.
 */
import type { Terminal } from '@xterm/xterm';

const registry = new Map<string, Terminal>();

/** Register a terminal instance for its session id. */
export function registerTerminal(id: string, term: Terminal): void {
  registry.set(id, term);
}

/** Drop a terminal instance (on dispose). */
export function unregisterTerminal(id: string): void {
  registry.delete(id);
}

/**
 * Focus the terminal for the given session id.
 *
 * @param id - Session id / セッションID
 * @returns true if a terminal was found and focused / フォーカスできたか
 */
export function focusTerminal(id: string): boolean {
  const term = registry.get(id);
  if (!term) return false;
  term.focus();
  return true;
}
