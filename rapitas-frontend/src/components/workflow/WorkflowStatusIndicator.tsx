'use client';

import { useTranslations } from 'next-intl';
import type { WorkflowStatus, WorkflowRoleConfig } from '@/types';
import {
  FileSearch,
  FileText,
  CheckCircle,
  Code,
  FlaskConical,
  HelpCircle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

/**
 * Builds the per-status display config. A function (not a module constant)
 * because labels are translated — `t` is only available inside a component.
 *
 * NOTE: Labels reflect the phase ACTUALLY running at each status (buildTransitions):
 * the researcher runs at draft (→ research_done), the planner runs at research_done
 * (→ plan_created) — except in lightweight mode where the implementer runs there
 * (research → implement, no plan). So draft = 調査中 and research_done = 計画中
 * (overridden to 実装中 for lightweight in the component below).
 * NOTE: All "agent actively running" statuses use BLUE — the app-wide running
 * color (user decision; see docs/design/ui-design-language.md §4 status hues).
 * Blue = running state, indigo = interactive accent. The verify phase was
 * purple, splitting the core "実行中" meaning across hues; phase identity is
 * carried by the icon + label, not the hue.
 *
 * @param t - Translator scoped to the `workflow` namespace / workflow名前空間のt
 * @returns Status → display config map / ステータスごとの表示設定
 */
function getStatusConfig(
  t: ReturnType<typeof useTranslations<'workflow'>>,
  tc: ReturnType<typeof useTranslations<'common'>>,
): Record<
  WorkflowStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    icon: LucideIcon;
  }
> {
  return {
    draft: {
      label: t('statusIndicator.researching'),
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-600',
      icon: FileSearch,
    },
    research_done: {
      label: t('statusIndicator.planning'),
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-600',
      icon: FileText,
    },
    plan_created: {
      label: t('statusIndicator.planCreated'),
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-900/30',
      borderColor: 'border-amber-300 dark:border-amber-600',
      icon: FileText,
    },
    // NOTE: At plan_approved the IMPLEMENTER runs (→ in_progress on completion), and
    // at in_progress the VERIFIER runs (→ verify_done). See buildTransitions: the
    // label must reflect the phase ACTUALLY running at this status, so plan_approved
    // is "実装中" and in_progress is "検証中" — previously in_progress was mislabeled
    // "実装中", making the verify phase look like it was still implementing.
    plan_approved: {
      label: t('statusIndicator.implementing'),
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-600',
      icon: Code,
    },
    in_progress: {
      label: t('statusIndicator.verifying'),
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-600',
      icon: FlaskConical,
    },
    awaiting_question: {
      label: t('statusIndicator.awaitingAnswer'),
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-900/30',
      borderColor: 'border-amber-300 dark:border-amber-600',
      icon: HelpCircle,
    },
    blocked: {
      label: t('statusIndicator.blocked'),
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-900/30',
      borderColor: 'border-red-300 dark:border-red-600',
      icon: AlertTriangle,
    },
    verify_done: {
      label: t('statusIndicator.verifyDone'),
      color: 'text-teal-600 dark:text-teal-400',
      bgColor: 'bg-teal-50 dark:bg-teal-900/30',
      borderColor: 'border-teal-300 dark:border-teal-600',
      icon: CheckCircle,
    },
    completed: {
      label: tc('completed'),
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/30',
      borderColor: 'border-green-300 dark:border-green-600',
      icon: CheckCircle,
    },
  };
}

interface WorkflowStatusIndicatorProps {
  status: WorkflowStatus | null;
  size?: 'sm' | 'md';
  /** Workflow mode — lightweight has no plan phase, so research_done = 実装中. */
  workflowMode?: string | null;
  /**
   * Why the task is blocked (e.g. the latest WorkflowTransition.cause, such as
   * `plan_invalid_replan_exhausted` or `verify_pr_not_created`). Only rendered
   * when `status === 'blocked'`. Callers that don't have this handy (it lives
   * in a separate `/workflow/tasks/:taskId/transitions` fetch, not on the Task
   * object itself) can omit it — a generic actionable hint is shown instead.
   */
  blockedCause?: string | null;
}

export default function WorkflowStatusIndicator({
  status,
  size = 'sm',
  workflowMode,
  blockedCause,
}: WorkflowStatusIndicatorProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  if (!status) return null;

  const config = getStatusConfig(t, tc)[status];
  if (!config) return null;

  // Lightweight skips planning (research → implement), so at research_done the
  // IMPLEMENTER runs, not the planner — show 実装中 instead of 計画中.
  const isLightweightImplement = status === 'research_done' && workflowMode === 'lightweight';
  const label = isLightweightImplement ? t('statusIndicator.implementing') : config.label;
  const Icon = isLightweightImplement ? Code : config.icon;
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5 gap-1' : 'text-sm px-3 py-1 gap-1.5';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  // The blocked pill otherwise gives no clue why — the cause only lives in the
  // notification feed / transitions log today. Surface whatever we have as a
  // tooltip rather than leaving a bare red badge.
  const title =
    status === 'blocked' ? (blockedCause ?? t('statusIndicator.blockedGenericHint')) : undefined;

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${config.bgColor} ${config.color} ${config.borderColor} ${sizeClasses}`}
      title={title}
    >
      <Icon className={iconSize} />
      {label}
    </span>
  );
}

// Workflow progress bar
const STAGES: WorkflowStatus[] = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
  'completed',
];

// Stage-to-role mapping
const STAGE_ROLES: Record<string, string> = {
  draft: 'researcher',
  research_done: 'planner',
  plan_created: 'reviewer',
  plan_approved: 'implementer',
  in_progress: 'verifier',
  verify_done: '',
  completed: '',
};

interface WorkflowProgressProps {
  currentStatus: WorkflowStatus;
  roles?: WorkflowRoleConfig[];
}

export function WorkflowProgress({ currentStatus, roles }: WorkflowProgressProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const statusConfig = getStatusConfig(t, tc);
  const currentIndex = STAGES.indexOf(currentStatus);

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, index) => {
        const config = statusConfig[stage];
        const isCompleted = index <= currentIndex;
        const isCurrent = index === currentIndex;
        const roleName = STAGE_ROLES[stage];
        const roleConfig = roles?.find((r) => r.role === roleName);

        return (
          <div key={stage} className="flex flex-col items-center gap-0.5 flex-1">
            <div
              className={`h-1.5 w-full rounded-full transition-colors ${
                isCompleted
                  ? isCurrent
                    ? 'bg-blue-500 dark:bg-blue-400'
                    : 'bg-blue-300 dark:bg-blue-600'
                  : 'bg-zinc-200 dark:bg-zinc-700'
              }`}
              title={config.label}
            />
            {roles && roleConfig?.agentConfig && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-full leading-tight">
                {roleConfig.agentConfig.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
