/**
 * workflowViewerUtils
 *
 * Pure utility functions and constants for WorkflowViewer: tab definitions,
 * status-to-role mappings, and tab-to-status auto-select mapping.
 * Contains no React or side-effect code.
 */

import type { WorkflowFileType, WorkflowStatus, WorkflowRole } from '@/types';
import { Search, FileText, CheckCircle, MessageSquare, Code } from 'lucide-react';
import type { WorkflowMode } from './CompactWorkflowSelector';

export interface WorkflowTab {
  id: WorkflowFileType;
  label: string;
  icon: typeof Search;
  emptyText: string;
}

/**
 * Returns the list of tabs visible for a given workflow mode.
 *
 * @param workflowMode - The active workflow mode string
 * @returns Filtered array of WorkflowTab definitions
 */
export const getWorkflowTabs = (workflowMode: string): WorkflowTab[] => {
  const allTabs: WorkflowTab[] = [
    {
      id: 'research',
      label: '調査',
      icon: Search,
      emptyText: 'AIエージェントが調査を実行するとresearch.mdが生成されます',
    },
    {
      id: 'question',
      label: 'Q&A',
      icon: MessageSquare,
      emptyText: '不明点がある場合、AIエージェントがquestion.mdを生成します',
    },
    {
      id: 'plan',
      label: '計画',
      icon: FileText,
      emptyText: '調査完了後にAIエージェントがplan.mdを生成します',
    },
    {
      id: 'verify',
      label: '検証',
      icon: CheckCircle,
      emptyText: '実装完了後にAIエージェントがverify.mdを生成します',
    },
  ];

  // NOTE: Research is now MANDATORY across all complexity tiers — the
  // research-only execution path (read-only sandbox, codex stdout → research.md)
  // runs as the very first phase regardless of workflowMode. The tabs reflect
  // that: research is always shown; remaining tabs scale with complexity.
  switch (workflowMode) {
    case 'lightweight':
      // Lightweight: research + verify (skip plan / Q&A)
      return allTabs.filter((tab) => ['research', 'verify'].includes(tab.id));
    case 'standard':
      // Standard: research + plan + Q&A + verify (skip nothing now that
      // research is mandatory)
      return allTabs.filter((tab) => ['research', 'question', 'plan', 'verify'].includes(tab.id));
    case 'comprehensive':
    default:
      // Comprehensive: all tabs (same as standard at present)
      return allTabs;
  }
};

export interface NextRoleInfo {
  role: WorkflowRole;
  label: string;
  icon: typeof Search;
}

/**
 * Returns the status-to-next-role mapping for a given workflow mode.
 *
 * @param workflowMode - The active workflow mode string
 * @returns Record mapping workflow status strings to their next-role info
 */
export const getStatusToNextRole = (workflowMode: string): Record<string, NextRoleInfo> => {
  // NOTE: All modes now start with the researcher role (research.md is a
  // mandatory first artifact). lightweight skips plan/review and goes
  // research → implement; standard inserts plan/review; comprehensive is
  // the same as standard at this point — kept distinct for future
  // divergence.
  const lightweightMode: Record<string, NextRoleInfo> = {
    draft: { role: 'researcher', label: 'リサーチ実行', icon: Search },
    research_done: { role: 'implementer', label: '実装開始', icon: Code },
    in_progress: {
      role: 'auto_verifier',
      label: '自動検証実行',
      icon: CheckCircle,
    },
  };

  const standardMode: Record<string, NextRoleInfo> = {
    draft: { role: 'researcher', label: 'リサーチ実行', icon: Search },
    research_done: { role: 'planner', label: '計画作成', icon: FileText },
    plan_created: {
      role: 'reviewer',
      label: 'レビュー実行',
      icon: MessageSquare,
    },
    plan_approved: { role: 'implementer', label: '実装開始', icon: Code },
    in_progress: { role: 'verifier', label: '検証実行', icon: CheckCircle },
  };

  const comprehensiveMode: Record<string, NextRoleInfo> = {
    draft: { role: 'researcher', label: 'リサーチ実行', icon: Search },
    research_done: { role: 'planner', label: '計画作成', icon: FileText },
    plan_created: {
      role: 'reviewer',
      label: 'レビュー実行',
      icon: MessageSquare,
    },
    plan_approved: { role: 'implementer', label: '実装開始', icon: Code },
    in_progress: { role: 'verifier', label: '検証実行', icon: CheckCircle },
  };

  switch (workflowMode) {
    case 'lightweight':
      return lightweightMode;
    case 'standard':
      return standardMode;
    case 'comprehensive':
    default:
      return comprehensiveMode;
  }
};

// Auto-selection mapping for tabs corresponding to status. `draft` now
// points at `research` so the user lands on the research tab immediately
// after the first execution kicks off (research is the always-on first phase).
export const STATUS_TO_TAB: Partial<Record<WorkflowStatus, WorkflowFileType>> = {
  draft: 'research',
  research_done: 'research',
  plan_created: 'plan',
  plan_approved: 'plan',
  in_progress: 'plan',
  verify_done: 'verify',
  completed: 'verify',
};

/**
 * Determines the effective workflow mode to use for display purposes.
 *
 * @param workflowMode - The raw workflow mode prop value (may be null)
 * @returns A resolved WorkflowMode string (defaults to 'comprehensive')
 */
export const resolveWorkflowMode = (workflowMode: WorkflowMode | null | undefined): WorkflowMode =>
  workflowMode || 'comprehensive';
