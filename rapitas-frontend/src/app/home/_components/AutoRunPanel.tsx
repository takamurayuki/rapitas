/**
 * AutoRunPanel
 *
 * The frame of the toolbar's auto-run control: a divider, a one-line pill
 * with the state (marker, "自動実行", state text) in the state's colour, then
 * the actions beside it. Not responsible for the actions or for reading the
 * auto-run state.
 *
 * NOTE: Design C (2026-11-21). The task, its phase and the backlog moved to
 * AutoRunProgressStrip under the toolbar, so this no longer needs the
 * two-line bordered panel (#1674) that held caption, state and buttons; a
 * pill says which state the machine is in and leaves the row light.
 */
import type { ReactNode } from 'react';

/** Auto-run states the panel can show. */
export type AutoRunPanelState = 'idle' | 'running' | 'paused' | 'stopping';

// Status hues from docs/design/ui-design-language.md: emerald is the auto-run
// active state, amber is waiting; idle and stopping stay neutral.
const BORDER: Record<AutoRunPanelState, string> = {
  running: 'border-emerald-400 dark:border-emerald-800',
  paused: 'border-amber-300 dark:border-amber-800',
  idle: 'border-zinc-300 dark:border-zinc-700',
  stopping: 'border-zinc-300 dark:border-zinc-700',
};

interface AutoRunPanelProps {
  /** Current state; picks the pill's border colour. / 現在の状態 */
  state: AutoRunPanelState;
  /** Label before the state (自動実行); omitted when the state text already says it. / 見出し */
  caption?: string;
  /** Marker and text for the state. / 状態の表示 */
  status: ReactNode;
  /** The actions (開始 / 再開 / 停止) and an error badge. / 操作ボタン */
  children?: ReactNode;
}

/**
 * Draw the auto-run state as a pill with its actions beside it, behind a divider.
 *
 * @param props.state - Current state / 現在の状態
 * @param props.caption - Label / 見出し
 * @param props.status - State marker and text / 状態の表示
 * @param props.children - Actions / 操作ボタン
 * @returns Divider, pill and actions / 区切り線・ピル・操作ボタン
 */
export function AutoRunPanel({ state, caption, status, children }: AutoRunPanelProps) {
  return (
    <>
      {/* Drawn here, not by the toolbar: the control renders nothing for
          non-development themes, and a toolbar divider would be left over. */}
      <span
        data-testid="auto-run-divider"
        aria-hidden="true"
        className="mx-1 h-8 w-px shrink-0 bg-zinc-300 dark:bg-zinc-600"
      />
      <div
        data-toolbar-group="auto-run"
        data-auto-run-state={state}
        className="flex items-center gap-2"
      >
        <span
          data-auto-run-pill=""
          className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[13px] whitespace-nowrap select-none dark:bg-zinc-900 ${BORDER[state]}`}
        >
          {caption && <span className="text-zinc-500 dark:text-zinc-400">{caption}</span>}
          <span
            data-auto-run-status=""
            className="inline-flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-100"
          >
            {status}
          </span>
        </span>
        {children}
      </div>
    </>
  );
}
