'use client';

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

const STATUS_CONFIG: Record<
  WorkflowStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    icon: LucideIcon;
  }
> = {
  // NOTE: Labels reflect the phase ACTUALLY running at each status (buildTransitions):
  // the researcher runs at draft (→ research_done), the planner runs at research_done
  // (→ plan_created) — except in lightweight mode where the implementer runs there
  // (research → implement, no plan). So draft = 調査中 and research_done = 計画中
  // (overridden to 実装中 for lightweight below).
  // NOTE: All "agent actively running" statuses use INDIGO — the app-wide running
  // color (see StatusCard). They were blue/purple here, splitting the core
  // "実行中" meaning across three hues between screens; phase identity is carried
  // by the icon + label, not the hue.
  draft: {
    label: '調査中',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/30',
    borderColor: 'border-indigo-300 dark:border-indigo-600',
    icon: FileSearch,
  },
  research_done: {
    label: '計画中',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/30',
    borderColor: 'border-indigo-300 dark:border-indigo-600',
    icon: FileText,
  },
  plan_created: {
    label: '計画作成済',
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
    label: '実装中',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/30',
    borderColor: 'border-indigo-300 dark:border-indigo-600',
    icon: Code,
  },
  in_progress: {
    label: '検証中',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/30',
    borderColor: 'border-indigo-300 dark:border-indigo-600',
    icon: FlaskConical,
  },
  awaiting_question: {
    label: '回答待ち',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/30',
    borderColor: 'border-amber-300 dark:border-amber-600',
    icon: HelpCircle,
  },
  blocked: {
    label: 'ブロック中',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-red-300 dark:border-red-600',
    icon: AlertTriangle,
  },
  verify_done: {
    label: '検証完了',
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-50 dark:bg-teal-900/30',
    borderColor: 'border-teal-300 dark:border-teal-600',
    icon: CheckCircle,
  },
  completed: {
    label: '完了',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/30',
    borderColor: 'border-green-300 dark:border-green-600',
    icon: CheckCircle,
  },
};

interface WorkflowStatusIndicatorProps {
  status: WorkflowStatus | null;
  size?: 'sm' | 'md';
  /** Workflow mode — lightweight has no plan phase, so research_done = 実装中. */
  workflowMode?: string | null;
}

export default function WorkflowStatusIndicator({
  status,
  size = 'sm',
  workflowMode,
}: WorkflowStatusIndicatorProps) {
  if (!status) return null;

  const config = STATUS_CONFIG[status];
  if (!config) return null;

  // Lightweight skips planning (research → implement), so at research_done the
  // IMPLEMENTER runs, not the planner — show 実装中 instead of 計画中.
  const isLightweightImplement = status === 'research_done' && workflowMode === 'lightweight';
  const label = isLightweightImplement ? '実装中' : config.label;
  const Icon = isLightweightImplement ? Code : config.icon;
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5 gap-1' : 'text-sm px-3 py-1 gap-1.5';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${config.bgColor} ${config.color} ${config.borderColor} ${sizeClasses}`}
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
  const currentIndex = STAGES.indexOf(currentStatus);

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, index) => {
        const config = STATUS_CONFIG[stage];
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
