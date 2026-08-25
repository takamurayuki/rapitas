import React, { useEffect, useState } from 'react';
import type { Task } from '@/types';
import type { WorkflowStatus } from '@/types';
import WorkflowViewer from '@/components/workflow/WorkflowViewer';
import WorkflowStatusIndicator from '@/components/workflow/WorkflowStatusIndicator';
import { CircleSmall, Diamond, GitBranch, Pyramid, Zap, type LucideIcon } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { Spinner } from '@/components/ui/spinner';
import { resolveBlockedCauseLabel } from '@/components/workflow/workflow-blocked-cause';
import CriticHistorySection from '@/components/workflow/CriticHistorySection';
import PhaseBreakdown from '@/feature/tasks/components/detail/PhaseBreakdown';
import { useWorkflowDisabledToggle } from '../hooks/useWorkflowDisabledToggle';

export interface TaskWorkflowSectionProps {
  task: Task;
  taskId: number;
  currentWorkflowStatus: WorkflowStatus | null;
  setCurrentWorkflowStatus: (status: WorkflowStatus) => void;
  isWorkflowLoading: boolean;
  workflowError: string | null | undefined;
  onPlanApprovalRequest: () => void;
  onTaskUpdated?: () => void;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
}

/**
 * Workflow section component for development theme tasks.
 * Displays workflow status, progress, viewer, and error states.
 */
export default function TaskWorkflowSection({
  task,
  taskId,
  currentWorkflowStatus,
  setCurrentWorkflowStatus,
  isWorkflowLoading,
  workflowError,
  onPlanApprovalRequest,
  onTaskUpdated,
  setTask,
}: TaskWorkflowSectionProps) {
  const t = useTranslations('workflow');

  // task.status (not workflowStatus) is what actually goes 'blocked' — the
  // phase pill above only tracks workflowStatus, which stays at whatever
  // phase it last reached (e.g. 'plan_approved') even while the task itself
  // is blocked. Cast is needed because Status only types 'todo'/'in-progress'/
  // 'done' at the type level, though the backend also sends 'blocked'/'failed'
  // (same pattern as TaskCard.tsx's isRetryable check).
  const isBlocked = (task?.status as string) === 'blocked';

  // Why the task is blocked — fetched lazily (only while blocked) from the
  // append-only WorkflowTransition log, since the cause isn't on the Task
  // object itself. See BLOCKED_CAUSE_I18N_KEYS above for the causes this
  // recognizes; anything else falls back to the generic hint.
  const [blockedCause, setBlockedCause] = useState<string | null>(null);

  useEffect(() => {
    if (!isBlocked || !taskId) {
      setBlockedCause(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          transitions?: Array<{ cause?: string | null }>;
        };
        if (cancelled || !data.success || !data.transitions?.length) return;
        const latestCause = data.transitions[data.transitions.length - 1]?.cause ?? null;
        const label = resolveBlockedCauseLabel(t, latestCause);
        if (label) setBlockedCause(label);
      } catch {
        // Non-fatal — the pill falls back to the generic hint.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBlocked, taskId, t]);

  // The phase-critic gate can silently archive a freshly-saved research.md /
  // plan.md and roll workflowStatus back a step (research_done → draft,
  // plan_created → research_done) when it fails quality review — a bounded
  // self-repair loop (see phase-critic-gate.ts). Without this, the file just
  // vanishes from the viewer and the status regresses with no visible
  // explanation, reading as "why did my saved file disappear?". Surface the
  // rejection reason whenever the CURRENT status is exactly the rollback
  // target of the latest such transition (i.e. nothing has superseded it yet
  // — a fresh research.md/plan.md save moves the status forward again and
  // this banner naturally stops matching).
  const [criticRejection, setCriticRejection] = useState<{
    phase: 'research' | 'plan';
    reasons: string[];
    severity: number | null;
  } | null>(null);

  useEffect(() => {
    if (
      !taskId ||
      (currentWorkflowStatus !== 'draft' && currentWorkflowStatus !== 'research_done')
    ) {
      setCriticRejection(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          transitions?: Array<{
            cause?: string | null;
            toStatus?: string | null;
            metadata?: { reasons?: unknown; severity?: unknown };
          }>;
        };
        if (cancelled || !data.success || !data.transitions?.length) return;
        const latest = data.transitions[data.transitions.length - 1];
        const phase =
          latest?.cause === 'research_critic_failed'
            ? 'research'
            : latest?.cause === 'plan_critic_failed'
              ? 'plan'
              : null;
        if (!phase || latest?.toStatus !== currentWorkflowStatus) {
          setCriticRejection(null);
          return;
        }
        const reasons = Array.isArray(latest.metadata?.reasons)
          ? latest.metadata!.reasons.filter((r): r is string => typeof r === 'string')
          : [];
        const severity =
          typeof latest.metadata?.severity === 'number' ? latest.metadata.severity : null;
        setCriticRejection({ phase, reasons, severity });
      } catch {
        // Non-fatal — the banner simply doesn't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, currentWorkflowStatus]);

  // Compute the *effective* auto-approve state by OR-ing the task-level flag
  // with the global UserSettings entries — matches the backend rule in
  // `_handlePlanAutoApprove`. Without this the indicator showed OFF when only
  // the global setting was on.
  const [globalAutoApprove, setGlobalAutoApprove] = useState<{
    autoApprovePlan: boolean;
    autoApproveSubtaskPlan: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (!res.ok) return;
        const settings = await res.json();
        if (cancelled) return;
        setGlobalAutoApprove({
          autoApprovePlan: !!settings.autoApprovePlan,
          autoApproveSubtaskPlan: !!settings.autoApproveSubtaskPlan,
        });
      } catch {
        // Non-fatal — fall back to task-level only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    effectiveWorkflowDisabled,
    globallyForced: workflowDisabledGloballyForced,
    isLocked: workflowToggleLocked,
    isToggling: isTogglingWorkflowDisabled,
    toggle: handleToggleWorkflowDisabled,
  } = useWorkflowDisabledToggle(taskId, task, setTask);

  const isSubtask = !!task?.parentId;
  const taskFlag = !!task?.autoApprovePlan;
  const globalFlag = !!globalAutoApprove?.autoApprovePlan;
  const subtaskGlobalFlag = isSubtask && !!globalAutoApprove?.autoApproveSubtaskPlan;
  const effectiveAutoApprove = taskFlag || globalFlag || subtaskGlobalFlag;
  const autoApproveSource: 'task' | 'global' | 'subtask-global' | undefined = taskFlag
    ? 'task'
    : globalFlag
      ? 'global'
      : subtaskGlobalFlag
        ? 'subtask-global'
        : undefined;

  // Colour + icon the complexity chip by workflow mode. A cohesive shape
  // progression for 簡単/標準/高度: CircleSmall (a small dot) → Diamond → Pyramid
  // (layered/hierarchical = complex). Colours go emerald → blue → rose (easy→hard).
  const MODE_STYLES: Record<string, { chip: string; icon: LucideIcon }> = {
    lightweight: {
      chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      icon: CircleSmall,
    },
    standard: {
      chip: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      icon: Diamond,
    },
    comprehensive: {
      chip: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      icon: Pyramid,
    },
  };
  const MODE_LABELS: Record<string, string> = {
    lightweight: t('modeLightweight'),
    standard: t('modeStandard'),
    comprehensive: t('modeComprehensive'),
  };
  const complexity = task?.complexityScore;
  const modeLabel = task?.workflowMode
    ? (MODE_LABELS[task.workflowMode] ?? task.workflowMode)
    : null;
  const modeStyle = task?.workflowMode ? MODE_STYLES[task.workflowMode] : undefined;
  // Brand-coloured fallback keeps the chip visible when the mode is unknown.
  const complexityChipClass =
    modeStyle?.chip ?? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  const ComplexityIcon = modeStyle?.icon ?? Diamond;

  // Escalating colour so a severity-92 rejection reads as more urgent than a
  // severity-55 one at a glance, instead of every rejection looking identical.
  const severityStyle = (severity: number | null): { label: string; chip: string } | null => {
    if (severity == null) return null;
    if (severity >= 80) {
      return {
        label: t('taskWorkflowSection.criticRejection.severity.high'),
        chip: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      };
    }
    if (severity >= 50) {
      return {
        label: t('taskWorkflowSection.criticRejection.severity.medium'),
        chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      };
    }
    return {
      label: t('taskWorkflowSection.criticRejection.severity.low'),
      chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    };
  };

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg border border-zinc-200 dark:border-zinc-800 mb-6">
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <GitBranch className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h3>
            <WorkflowStatusIndicator
              status={isBlocked ? 'blocked' : currentWorkflowStatus}
              size="sm"
              workflowMode={task?.workflowMode}
              blockedCause={isBlocked ? blockedCause : undefined}
            />
            {/* Loading spinner lives on the left so the right chips end flush
                with the card padding (matching the title's left inset). */}
            {isWorkflowLoading && (
              <Spinner size="sm" className="text-zinc-400 dark:text-zinc-400" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {(modeLabel || complexity != null) && (
              <span
                className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${complexityChipClass}`}
                title={
                  modeLabel
                    ? task?.workflowModeOverride
                      ? t('taskWorkflowSection.modeTooltipManual', { mode: modeLabel })
                      : t('taskWorkflowSection.modeTooltipAuto', { mode: modeLabel })
                    : undefined
                }
              >
                <ComplexityIcon className="h-3.5 w-3.5" />
                {modeLabel ?? t('title')}
                {complexity != null
                  ? t('taskWorkflowSection.complexitySuffix', { score: Math.round(complexity) })
                  : // Not yet assessed: the score now comes exclusively from the
                    // research agent's code-grounded evaluation — show a pending
                    // "-" instead of hiding the field (or a heuristic guess).
                    t('taskWorkflowSection.complexityPendingSuffix')}
                {task?.workflowModeOverride ? t('taskWorkflowSection.manualSuffix') : ''}
              </span>
            )}
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                effectiveAutoApprove
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
              title={
                effectiveAutoApprove
                  ? t('taskWorkflowSection.autoApproveTooltipOn')
                  : t('taskWorkflowSection.autoApproveTooltipOff')
              }
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${effectiveAutoApprove ? 'bg-emerald-500' : 'bg-zinc-400'}`}
              />
              {t('taskWorkflowSection.autoApproveBadge', {
                state: effectiveAutoApprove ? 'ON' : 'OFF',
              })}
            </span>
            {/* Per-task "skip the multi-phase workflow" toggle — locked once
                the task has left 'todo' (server-enforced too, see
                handleSetWorkflowDisabled). Reflects task.workflowDisabled;
                the global setting can independently force this on regardless
                of the task-level value (see effectiveWorkflowDisabled). */}
            <span
              className="flex shrink-0 items-center gap-1.5"
              title={
                workflowToggleLocked
                  ? t('taskWorkflowSection.workflowDisabledToggle.lockedTooltip')
                  : workflowDisabledGloballyForced
                    ? t('taskWorkflowSection.workflowDisabledToggle.globallyForcedTooltip')
                    : effectiveWorkflowDisabled
                      ? t('taskWorkflowSection.workflowDisabledToggle.onTooltip')
                      : t('taskWorkflowSection.workflowDisabledToggle.offTooltip')
              }
            >
              <Zap
                className={`h-3 w-3 ${
                  effectiveWorkflowDisabled
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-zinc-400 dark:text-zinc-500'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  effectiveWorkflowDisabled
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {t('taskWorkflowSection.workflowDisabledToggle.label')}
              </span>
              {/* The switch carries the state, so the ON/OFF word the pill used
                  to spell out is gone — two representations of one boolean is
                  one too many. */}
              <Toggle
                checked={effectiveWorkflowDisabled}
                onChange={handleToggleWorkflowDisabled}
                disabled={workflowToggleLocked || isTogglingWorkflowDisabled}
                size="sm"
                color="amber"
                srLabel={t('taskWorkflowSection.workflowDisabledToggle.label')}
              />
            </span>
          </div>
        </div>
      </div>

      <WorkflowViewer
        taskId={taskId}
        workflowStatus={currentWorkflowStatus}
        workflowMode={task?.workflowMode}
        complexityScore={task?.complexityScore}
        workflowModeOverride={task?.workflowModeOverride ?? undefined}
        autoApprovePlan={effectiveAutoApprove}
        autoApprovePlanSource={autoApproveSource}
        onPlanApprovalRequest={onPlanApprovalRequest}
        onStatusChange={(newStatus) => {
          setCurrentWorkflowStatus(newStatus);
          if (onTaskUpdated) onTaskUpdated();
        }}
        onWorkflowModeChange={(mode, isOverride) => {
          if (task) {
            setTask((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                workflowMode: mode,
                workflowModeOverride: isOverride,
              };
            });
            if (onTaskUpdated) onTaskUpdated();
          }
        }}
        // NOTE: autoApprovePlan is read-only here — the workflow tab only
        // displays the current value. Editing happens via the task settings
        // page so the UX matches the "状態表示だけ" policy.
        showWorkflowMode={true}
        criticRejectionPhase={criticRejection?.phase ?? null}
        workflowDisabled={effectiveWorkflowDisabled}
      />

      {criticRejection &&
        (() => {
          const severity = severityStyle(criticRejection.severity);
          return (
            <div className="px-4 pb-4">
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
                    {t('taskWorkflowSection.criticRejection.title', {
                      phase: t(
                        `taskWorkflowSection.criticRejection.phase.${criticRejection.phase}`,
                      ),
                    })}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {severity && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${severity.chip}`}
                      >
                        {severity.label}
                        {criticRejection.severity != null ? ` (${criticRejection.severity})` : ''}
                      </span>
                    )}
                    {criticRejection.reasons.length > 1 && (
                      <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        {t('taskWorkflowSection.criticRejection.reasonsCount', {
                          count: criticRejection.reasons.length,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {criticRejection.reasons.length > 0 && (
                  <ul className="mt-2 list-disc list-outside space-y-1.5 pl-5 text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
                    {criticRejection.reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}

      {/* フェーズ別実行時間（role × 各回の実働内訳、task #560） */}
      <PhaseBreakdown taskId={taskId} />

      <CriticHistorySection taskId={taskId} />

      {workflowError && (
        <div className="px-4 pb-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300">{workflowError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
