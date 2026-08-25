'use client';
// WorkflowTabBar

import { Clock, RefreshCw, CheckCircle2, HelpCircle } from 'lucide-react';
import { PlanRevisionRequest } from './PlanRevisionRequest';
import { useTranslations } from 'next-intl';
import type { WorkflowFileType, WorkflowStatus } from '@/types';
import type { WorkflowTab } from './workflow-viewer-utils';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

interface WorkflowTabBarProps {
  /** Tabs to display (filtered by the current workflow mode) */
  tabs: WorkflowTab[];
  /** Currently selected tab id */
  activeTab: WorkflowFileType;
  /** Whether each tab has a corresponding file */
  tabStatus: Record<WorkflowFileType, boolean>;
  /** Resolved effective status used to determine badge visibility */
  effectiveStatus: WorkflowStatus | null;
  /** Number of pending Q&A questions (badged on the Q&A tab). / Q&A質問数 */
  questionCount?: number;
  /** Called when user clicks a tab */
  onTabChange: (tab: WorkflowFileType) => void;
  /** Active file's last-modified time; undefined when no file is shown. */
  lastModified?: string | null;
  /** Manual reload trigger (rendered at the right of the tab row). */
  onRefetch?: () => void;
  /** Whether a reload is in flight. */
  isRefetching?: boolean;
  /**
   * Tab currently being regenerated after a phase-critic rejection (see
   * WorkflowViewer's criticRejectionPhase). While its file is absent this
   * tab shows a "regenerating" indicator instead of nothing, so the empty
   * state doesn't read as "the file was lost".
   */
  regeneratingTab?: 'research' | 'plan' | null;
  /**
   * Task id — enables the plan-revision request. Shown only while the PLAN tab
   * is selected: it acts on plan.md, so offering it from another tab would be
   * ambiguous about what is being revised.
   */
  taskId?: number;
}

/**
 * Tab navigation bar for workflow file types.
 *
 * @param tabs - Tab definitions visible in the current mode
 * @param activeTab - Currently selected tab
 * @param tabStatus - Map of file-type to existence flag
 * @param effectiveStatus - Current workflow status for badge logic
 * @param onTabChange - Tab-selection handler / タブ選択ハンドラ
 */
export function WorkflowTabBar({
  tabs,
  activeTab,
  tabStatus,
  effectiveStatus,
  questionCount = 0,
  onTabChange,
  lastModified,
  onRefetch,
  isRefetching,
  regeneratingTab = null,
  taskId,
}: WorkflowTabBarProps) {
  const t = useTranslations('workflow');
  const tAutoRun = useTranslations('autoRun');
  const locale = useLocaleStore((s) => s.locale);
  return (
    // Sticky below the task-detail toolbar (top-11) so the tabs stay reachable
    // while scrolling the file; the in-file TOC sticks just beneath this bar.
    <div className="sticky top-11 z-[6] flex items-center justify-between border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900">
      <nav className="flex">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const hasContent = tabStatus[tab.id];
          const TabIcon = tab.icon;
          // Attention badges: a plan awaiting approval, or a question awaiting the
          // user's answer. While awaiting an answer the Q&A tab must NOT show the
          // "done" check (that wrongly reads as answered) — show 要回答 instead; the
          // check appears only once the question has been answered/resolved.
          const planNeedsApproval =
            tab.id === 'plan' && effectiveStatus === 'plan_created' && hasContent;
          const questionNeedsAnswer =
            tab.id === 'question' && effectiveStatus === 'awaiting_question' && hasContent;
          const needsAttention = planNeedsApproval || questionNeedsAnswer;
          // The "done" check and the question count are mutually exclusive: once
          // answered (check shown) the count is stale noise, so suppress it.
          const showDoneCheck = hasContent && !needsAttention;
          // The phase-critic gate archives a rejected research.md/plan.md, so
          // the file briefly reports !hasContent while it regenerates. Without
          // this the tab would look identical to "never produced" (see the
          // final `null` branch below).
          const isRegenerating = !hasContent && tab.id === regeneratingTab;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex items-center gap-2 py-3 px-5 border-b-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300'
              }`}
            >
              <TabIcon className="h-4 w-4" />
              <span>{tab.label}</span>
              {/* Question count: lets the user see at a glance how many questions
                  await before opening the tab. Hidden once answered (the done
                  check takes over) per user request. */}
              {tab.id === 'question' && questionCount > 0 && !showDoneCheck && (
                <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {questionCount}
                </span>
              )}
              {
                needsAttention ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium rounded-full">
                    {questionNeedsAnswer ? (
                      <HelpCircle className="h-2.5 w-2.5" />
                    ) : (
                      <Clock className="h-2.5 w-2.5" />
                    )}
                    {questionNeedsAnswer ? t('tabBar.answerNeeded') : tAutoRun('awaitingApproval')}
                  </span>
                ) : hasContent ? (
                  // A filled check reads as "this phase is done" — the previous
                  // solid green dot looked like a live/active status light.
                  <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400" />
                ) : isRegenerating ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium rounded-full">
                    <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    {t('tabBar.regenerating')}
                  </span>
                ) : null
                // Not produced yet (and not regenerating): show nothing — an
                // in-progress phase surfaces its own loading indicator elsewhere.
              }
            </button>
          );
        })}
      </nav>
      {onRefetch && (
        <div className="flex shrink-0 items-center gap-2 px-3 text-xs text-zinc-500 dark:text-zinc-400">
          {activeTab === 'plan' && tabStatus.plan && typeof taskId === 'number' && (
            <PlanRevisionRequest taskId={taskId} onRequested={onRefetch} />
          )}
          {lastModified !== undefined && (
            <span>
              {t('tabBar.updated')}{' '}
              {lastModified
                ? new Date(lastModified).toLocaleString(toDateLocale(locale))
                : t('planApprovalModal.unknown')}
            </span>
          )}
          <button
            onClick={onRefetch}
            disabled={isRefetching}
            title={t('tabBar.reload')}
            className="text-zinc-500 transition-colors hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}
    </div>
  );
}
