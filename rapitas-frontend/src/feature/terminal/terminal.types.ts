/**
 * terminal.types
 *
 * Shared types for the integrated terminal feature (dock panel, tabs, split
 * panes). UI-only — PTY ownership lives in the Rust backend.
 */

/** Layout direction of the panes inside a single tab. */
export type SplitDirection = 'row' | 'column';

/** One terminal pane. `id` doubles as the backend PTY session id. */
export interface PaneState {
  id: string;
  /**
   * Command to pre-fill at the prompt once the PTY is ready (NOT auto-executed).
   * Used when opening the terminal for an action — e.g. a CLI install command
   * from the tools page — so the user reviews it and presses Enter themselves.
   */
  initialCommand?: string;
}

/** A terminal tab containing one or more split panes. */
export interface TabState {
  id: string;
  title: string;
  /** Working directory shared by all panes in this tab (e.g. a task worktree). */
  cwd?: string;
  direction: SplitDirection;
  panes: PaneState[];
  activePaneId: string;
}

/** Payload of the `terminal://output` event (base64-encoded raw bytes). */
export interface TerminalOutputEvent {
  id: string;
  data: string;
}

/** Payload of the `terminal://exit` event. */
export interface TerminalExitEvent {
  id: string;
}
