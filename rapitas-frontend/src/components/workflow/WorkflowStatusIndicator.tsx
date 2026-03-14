'use client';

import type { WorkflowStatus, WorkflowRoleConfig } from '@/types';
import {
  FileSearch,
  FileText,
  CheckCircle,
  Clock,
  PlayCircle,
  Circle,
} from 'lucide-react';

const STATUS_CONFIG: Record<
  WorkflowStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    icon: typeof Circle;
  }
> = {
  draft: {
    label: '下書き',
    color: 'text-zinc-500 dark:text-zinc-400',
    bgColor: 'bg-zinc-100 dark:bg-zinc-800',
    borderColor: 'border-zinc-300 dark:border-zinc-600',
    icon: Circle,
  },
  research_done: {
    label: '調査完了',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/30',
    borderColor: 'border-blue-300 dark:border-blue-600',
    icon: FileSearch,
  },
  plan_created: {
    label: '計画作成済',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/30',
    borderColor: 'border-amber-300 dark:border-amber-600',
    icon: FileText,
  },
  plan_approved: {
    label: '計画承認済',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/30',
    borderColor: 'border-indigo-300 dark:border-indigo-600',
    icon: CheckCircle,
  },
  in_progress: {
    label: '実装中',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/30',
    borderColor: 'border-blue-300 dark:border-blue-600',
    icon: PlayCircle,
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
}

export default function WorkflowStatusIndicator({
  status,
  size = 'sm',
}: WorkflowStatusIndicatorProps) {
  if (!status) return null;

  const config = STATUS_CONFIG[status];
  if (!config) return null;

  const Icon = config.icon;
  const sizeClasses =
    size === 'sm' ? 'text-xs px-2 py-0.5 gap-1' : 'text-sm px-3 py-1 gap-1.5';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${config.bgColor} ${config.color} ${config.borderColor} ${sizeClasses}`}
    >
      <Icon className={iconSize} />
      {config.label}
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

export function WorkflowProgress({
  currentStatus,
  roles,
}: WorkflowProgressProps) {
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
          <div
            key={stage}
            className="flex flex-col items-center gap-0.5 flex-1"
          >
            <div
              className={`h-1.5 w-full rounded-full transition-colors ${
                isCompleted
                  ? isCurrent
                    ? 'bg-indigo-500 dark:bg-indigo-400'
                    : 'bg-indigo-300 dark:bg-indigo-600'
                  : 'bg-zinc-200 dark:bg-zinc-700'
              }`}
              title={config.label}
            />
            {roles && roleConfig?.agentConfig && (
              <span className="text-[9px] text-zinc-400 dark:text-zinc-500 truncate max-w-full leading-tight">
                {roleConfig.agentConfig.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
