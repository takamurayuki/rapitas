'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  FileText,
  Pencil,
  Wrench,
  CheckCircle2,
  Loader2,
  Clock,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { ExecutionLogViewer, type ExecutionLogStatus } from './ExecutionLogViewer';

/** Workflow phase definition */
export type WorkflowPhase = 'research' | 'plan' | 'implement' | 'verify';

/** Phase status */
export type PhaseStatus = 'waiting' | 'running' | 'completed' | 'failed' | 'skipped' | 'approved';

/** Logs per phase */
export interface PhaseLogGroup {
  phase: WorkflowPhase;
  status: PhaseStatus;
  logs: string[];
  startTime?: string;
  endTime?: string;
}

interface WorkflowLogViewerProps {
  /** Subtask title */
  taskTitle: string;
  /** Subtask ID */
  taskId: number;
  /** All log messages */
  logs: Array<{ timestamp: string; message: string; level: string }>;
  /** Workflow status (DB workflowStatus) */
  workflowStatus?: string;
  /** Whether running */
  isRunning?: boolean;
  /** Max height */
  maxHeight?: number;
}

/** Phase display config */
const PHASE_CONFIG: Record<
  WorkflowPhase,
  {
    label: string;
    icon: React.ElementType;
    keywords: string[];
  }
> = {
  research: {
    label: '調査フェーズ',
    icon: Search,
    keywords: ['[research]', '調査', 'research_done', '依存関係を分析', '影響範囲'],
  },
  plan: {
    label: '計画フェーズ',
    icon: FileText,
    keywords: ['[plan]', '計画', 'plan_created', 'plan_approved', '自動承認', '実装計画'],
  },
  implement: {
    label: '実装フェーズ',
    icon: Wrench,
    keywords: ['[implement]', '実装', 'in_progress', '編集中', 'テストを実行', 'コミット'],
  },
  verify: {
    label: '検証フェーズ',
    icon: CheckCircle2,
    keywords: ['[verify]', '検証', 'verify', '完了', 'completed'],
  },
};

const PHASE_ORDER: WorkflowPhase[] = ['research', 'plan', 'implement', 'verify'];

/**
 * Detect workflow phase from log message
 */
function detectPhase(message: string): WorkflowPhase | null {
  const lowerMsg = message.toLowerCase();
  for (const phase of PHASE_ORDER) {
    const config = PHASE_CONFIG[phase];
    if (config.keywords.some((kw) => lowerMsg.includes(kw.toLowerCase()))) {
      return phase;
    }
  }
  return null;
}

/**
 * Generate phase status map from workflow status
 */
function getPhaseStatuses(workflowStatus?: string): Record<WorkflowPhase, PhaseStatus> {
  const statusMap: Record<WorkflowPhase, PhaseStatus> = {
    research: 'waiting',
    plan: 'waiting',
    implement: 'waiting',
    verify: 'waiting',
  };

  if (!workflowStatus) return statusMap;

  switch (workflowStatus) {
    case 'draft':
      statusMap.research = 'running';
      break;
    case 'research_done':
      statusMap.research = 'completed';
      statusMap.plan = 'running';
      break;
    case 'plan_created':
      statusMap.research = 'completed';
      statusMap.plan = 'completed';
      break;
    case 'plan_approved':
      statusMap.research = 'completed';
      statusMap.plan = 'approved';
      statusMap.implement = 'running';
      break;
    case 'in_progress':
      statusMap.research = 'completed';
      statusMap.plan = 'approved';
      statusMap.implement = 'running';
      break;
    case 'completed':
    case 'verify_done':
      statusMap.research = 'completed';
      statusMap.plan = 'approved';
      statusMap.implement = 'completed';
      statusMap.verify = 'completed';
      break;
    default:
      break;
  }

  return statusMap;
}

/** Return icon based on phase status */
function PhaseStatusIcon({ status }: { status: PhaseStatus }) {
  switch (status) {
    case 'completed':
    case 'approved':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'waiting':
      return <Clock className="w-4 h-4 text-zinc-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'skipped':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
  }
}

/** Phase status label */
function getStatusLabel(status: PhaseStatus): string {
  switch (status) {
    case 'completed':
      return '完了';
    case 'approved':
      return '承認済';
    case 'running':
      return '実行中';
    case 'waiting':
      return '待機中';
    case 'failed':
      return '失敗';
    case 'skipped':
      return 'スキップ';
  }
}

/**
 * WorkflowLogViewer - Group and display logs by workflow phase
 */
export function WorkflowLogViewer({
  taskTitle,
  taskId,
  logs,
  workflowStatus,
  isRunning = false,
  maxHeight = 300,
}: WorkflowLogViewerProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<WorkflowPhase>>(
    new Set(['research', 'plan', 'implement', 'verify']),
  );

  const togglePhase = useCallback((phase: WorkflowPhase) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  }, []);

  const phaseStatuses = useMemo(() => getPhaseStatuses(workflowStatus), [workflowStatus]);

  // Group logs by phase
  const phaseGroups = useMemo(() => {
    const groups: Record<WorkflowPhase, string[]> = {
      research: [],
      plan: [],
      implement: [],
      verify: [],
    };

    let currentPhase: WorkflowPhase = 'research';

    for (const log of logs) {
      const detected = detectPhase(log.message);
      if (detected) {
        currentPhase = detected;
      }
      groups[currentPhase].push(log.message);
    }

    return groups;
  }, [logs]);

  // Identify the currently active phase (first phase with running status)
  const activePhase = useMemo(() => {
    return PHASE_ORDER.find((p) => phaseStatuses[p] === 'running');
  }, [phaseStatuses]);

  const getPhaseLogStatus = useCallback(
    (phase: WorkflowPhase): ExecutionLogStatus => {
      const status = phaseStatuses[phase];
      switch (status) {
        case 'running':
          return 'running';
        case 'completed':
          return 'completed';
        case 'approved':
          return 'completed';
        case 'failed':
          return 'failed';
        default:
          return 'idle';
      }
    },
    [phaseStatuses],
  );

  return (
    <div className="space-y-1">
      {PHASE_ORDER.map((phase) => {
        const config = PHASE_CONFIG[phase];
        const Icon = config.icon;
        const status = phaseStatuses[phase];
        const phaseLogs = phaseGroups[phase];
        const isExpanded = expandedPhases.has(phase);
        const isActive = phase === activePhase;

        return (
          <div
            key={phase}
            className={`rounded-lg border transition-colors ${
              isActive
                ? 'border-blue-500/50 bg-blue-950/10'
                : status === 'completed' || status === 'approved'
                  ? 'border-green-500/20 bg-green-950/5'
                  : status === 'failed'
                    ? 'border-red-500/20 bg-red-950/5'
                    : 'border-zinc-700/50 bg-zinc-900/30'
            }`}
          >
            <button
              onClick={() => togglePhase(phase)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/30 rounded-t-lg transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive
                    ? 'text-blue-400'
                    : status === 'completed' || status === 'approved'
                      ? 'text-green-400'
                      : 'text-zinc-500'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isActive
                    ? 'text-blue-300'
                    : status === 'completed' || status === 'approved'
                      ? 'text-green-300'
                      : 'text-zinc-400'
                }`}
              >
                {config.label}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {phaseLogs.length > 0 && (
                  <span className="text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                    {phaseLogs.length}
                  </span>
                )}
                <PhaseStatusIcon status={status} />
                <span
                  className={`text-[10px] ${
                    status === 'running'
                      ? 'text-blue-400'
                      : status === 'completed' || status === 'approved'
                        ? 'text-green-400'
                        : status === 'failed'
                          ? 'text-red-400'
                          : 'text-zinc-500'
                  }`}
                >
                  {getStatusLabel(status)}
                </span>
              </div>
            </button>

            {isExpanded && phaseLogs.length > 0 && (
              <div className="px-1 pb-1">
                <ExecutionLogViewer
                  logs={phaseLogs}
                  status={getPhaseLogStatus(phase)}
                  isRunning={isActive}
                  collapsible={false}
                  showHeader={false}
                  maxHeight={Math.min(maxHeight / 2, 150)}
                />
              </div>
            )}

            {isExpanded && phaseLogs.length === 0 && status !== 'waiting' && (
              <div className="px-4 pb-2 text-[10px] text-zinc-500 italic">ログなし</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default WorkflowLogViewer;
