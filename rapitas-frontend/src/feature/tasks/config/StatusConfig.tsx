export const statusConfig = {
  todo: {
    color: 'text-zinc-700 dark:text-zinc-300',
    bgColor: 'bg-zinc-100 dark:bg-indigo-dark-800',
    borderColor: 'border-l-zinc-400 dark:border-l-zinc-600',
    label: '未着手',
  },
  'in-progress': {
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-50 dark:bg-blue-900/40',
    borderColor: 'border-l-blue-500 dark:border-l-blue-400',
    label: '進行中',
  },
  done: {
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-50 dark:bg-green-900/40',
    borderColor: 'border-l-green-500 dark:border-l-green-400',
    label: '完了',
  },
  // 'blocked' is set by the workflow when verification fails (needs a fix +
  // re-verify). Without an entry here the badge/icon rendered blank.
  blocked: {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-50 dark:bg-amber-900/40',
    borderColor: 'border-l-amber-500 dark:border-l-amber-400',
    label: '要対応',
  },
};

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
    case 'in-progress':
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
    case 'blocked':
      // Alert triangle — needs attention / re-verification.
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
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
