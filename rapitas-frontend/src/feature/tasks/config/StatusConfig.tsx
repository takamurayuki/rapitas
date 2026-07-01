export const statusConfig = {
  todo: {
    color: 'text-zinc-700 dark:text-zinc-300',
    bgColor: 'bg-zinc-100 dark:bg-indigo-dark-800',
    borderColor: 'border-l-zinc-400 dark:border-l-zinc-600',
    label: '未着手',
  },
  // NOTE: in-progress uses INDIGO — the app-wide "running" color (matches
  // StatusCard / WorkflowStatusIndicator). Was blue, which split the running
  // meaning across hues between screens.
  'in-progress': {
    color: 'text-indigo-700 dark:text-indigo-300',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/40',
    borderColor: 'border-l-indigo-500 dark:border-l-indigo-400',
    label: '進行中',
  },
  done: {
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-50 dark:bg-green-900/40',
    borderColor: 'border-l-green-500 dark:border-l-green-400',
    label: '完了',
  },
  // 'blocked' is an internal workflow state (waiting-for-input / verification
  // pending / transient failure during a run). Per UX request it is surfaced as
  // "進行中" — same look as in-progress — rather than a distinct ⚠ badge.
  blocked: {
    color: 'text-indigo-700 dark:text-indigo-300',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/40',
    borderColor: 'border-l-indigo-500 dark:border-l-indigo-400',
    label: '進行中',
  },
};

/**
 * Whether a status should be presented as "in progress" (drives the spinning
 * loader). `blocked` is treated as in-progress per UX request — a task in that
 * state is still mid-workflow, not a separate ⚠ state.
 *
 * @param status - Raw task status string. / タスクのステータス文字列
 * @returns True when the status should read as in-progress. / 進行中扱いか
 */
export const isInProgressStatus = (status: string | null | undefined): boolean =>
  status === 'in-progress' || status === 'blocked';

/**
 * Resolve a status config entry, falling back to `todo` for any unknown status
 * so the UI NEVER renders an empty status badge.
 *
 * @param status - Raw task status string. / タスクのステータス文字列
 * @returns A guaranteed-present status config entry. / 必ず存在する設定
 */
export const resolveStatusConfig = (status: string | null | undefined) =>
  statusConfig[status as keyof typeof statusConfig] || statusConfig.todo;

export const renderStatusIcon = (status: string) => {
  switch (status) {
    case 'todo':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <rect
            x="3"
            y="10"
            width="18"
            height="4"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      );
    // 'blocked' renders the same glyph as in-progress (surfaced as 進行中).
    case 'in-progress':
    case 'blocked':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <rect
            x="3"
            y="10"
            width="18"
            height="4"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
          <rect x="3" y="10" width="10" height="4" rx="2" fill="currentColor" />
        </svg>
      );
    case 'done':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      );
    default:
      // Never render nothing — fall back to the "todo" glyph so a task always
      // shows a status icon even for unmapped statuses.
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <rect
            x="3"
            y="10"
            width="18"
            height="4"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      );
  }
};

export type StatusConfig = typeof statusConfig;
export type StatusKey = keyof StatusConfig;
