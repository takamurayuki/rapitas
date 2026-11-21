/**
 * AutoRunPanel
 *
 * The frame of the toolbar's auto-run control: a divider, then a bordered
 * panel holding a small caption, the current state and the actions. Not
 * responsible for the actions or for reading the auto-run state.
 *
 * NOTE: A tinted group with an inline label (2026-11-21, #1670) did not set
 * the auto-run control apart from the task buttons — its tint matched the
 * page background, so only two small words remained. A panel with a caption
 * over the state and a border in the state's colour reads as "a machine and
 * its state" next to plain buttons. 48px tall around the 38px buttons, under
 * the toolbar row's 62px floor, so the row height does not change.
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
  /** Current state; picks the border colour. / 現在の状態 */
  state: AutoRunPanelState;
  /** Small caption over the state (自動実行). / 見出し */
  caption: string;
  /** Marker and text for the state. / 状態の表示 */
  status: ReactNode;
  /** The actions (開始 / 再開 / 停止) and an error badge. / 操作ボタン */
  children?: ReactNode;
}

/**
 * Frame the auto-run control as a status panel, behind a divider.
 *
 * @param props.state - Current state / 現在の状態
 * @param props.caption - Caption / 見出し
 * @param props.status - State marker and text / 状態の表示
 * @param props.children - Actions / 操作ボタン
 * @returns Divider plus panel / 区切り線とパネル
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
        className={`flex items-center gap-3 rounded-xl border bg-white py-1 pr-1 pl-3 dark:bg-zinc-900 ${BORDER[state]}`}
      >
        <div className="flex flex-col leading-tight select-none">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {caption}
          </span>
          <span
            data-auto-run-status=""
            className="inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap text-zinc-800 dark:text-zinc-100"
          >
            {status}
          </span>
        </div>
        {children}
      </div>
    </>
  );
}
