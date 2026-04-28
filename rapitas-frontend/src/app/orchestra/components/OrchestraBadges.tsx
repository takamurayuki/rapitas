'use client';
// OrchestraBadges

/**
 * Displays a coloured pill badge for a queue-item status value.
 *
 * @param status - Queue item status string (e.g. 'queued', 'running', 'failed')
 */
export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    queued: {
      bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      text: 'text-yellow-700 dark:text-yellow-300',
      label: 'キュー待ち',
    },
    running: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-700 dark:text-blue-300',
      label: '実行中',
    },
    waiting_approval: {
      bg: 'bg-orange-100 dark:bg-orange-900/30',
      text: 'text-orange-700 dark:text-orange-300',
      label: '承認待ち',
    },
    completed: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-300',
      label: '完了',
    },
    failed: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      label: '失敗',
    },
    cancelled: {
      bg: 'bg-gray-100 dark:bg-gray-800',
      text: 'text-gray-600 dark:text-gray-400',
      label: 'キャンセル',
    },
  };
  const c = config[status] || config.queued;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/**
 * Displays a coloured pill badge for a workflow phase value.
 *
 * @param phase - Workflow phase string (e.g. 'draft', 'in_progress', 'completed')
 */
export function PhaseBadge({ phase }: { phase: string }) {
  const labels: Record<string, string> = {
    draft: '下書き',
    research_done: '調査完了',
    plan_created: '計画作成',
    plan_approved: '計画承認',
    in_progress: '実装中',
    verify_done: '検証完了',
    completed: '完了',
  };
  return (
    <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
      {labels[phase] || phase}
    </span>
  );
}
