/**
 * workflowViewerUtils
 *
 * Pure utility functions and constants for WorkflowViewer: tab definitions,
 * status-to-role mappings, and tab-to-status auto-select mapping.
 * Contains no React or side-effect code.
 */

import type { WorkflowFileType, WorkflowStatus, WorkflowRole } from '@/types';
import { Search, FileText, FlaskConical, MessageSquare, Code } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { WorkflowMode } from './CompactWorkflowSelector';

// Translator bound to the 'workflow' message namespace; passed in by React
// callers so these pure helpers stay side-effect-free yet i18n-aware.
type WorkflowT = ReturnType<typeof useTranslations<'workflow'>>;

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
 * @param t - Translator bound to the 'workflow' namespace / 'workflow' 名前空間のトランスレータ
 * @returns Filtered array of WorkflowTab definitions
 */
export const getWorkflowTabs = (workflowMode: string, t: WorkflowT): WorkflowTab[] => {
  const allTabs: WorkflowTab[] = [
    {
      id: 'research',
      label: t('researchTab'),
      icon: Search,
      emptyText: t('researchEmpty'),
    },
    {
      id: 'question',
      label: t('qaTab'),
      icon: MessageSquare,
      emptyText: t('questionEmpty'),
    },
    {
      id: 'plan',
      label: t('planTab'),
      icon: FileText,
      emptyText: t('planEmpty'),
    },
    {
      id: 'verify',
      label: t('verifyTab'),
      icon: FlaskConical,
      emptyText: t('verifyEmpty'),
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
      // Standard: research + plan + Q&A + verify. Q&A stays available for
      // clarifying questions (which can occur in any mode); the difference vs
      // comprehensive is the plan-REVIEW phase, not the Q&A artifact view.
      return allTabs.filter((tab) => ['research', 'question', 'plan', 'verify'].includes(tab.id));
    case 'comprehensive':
    default:
      // Comprehensive: all tabs (Q&A holds clarifying questions; the reviewer
      // role that once produced question.md was retired 2026-08).
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
 * @param t - Translator bound to the 'workflow' namespace / 'workflow' 名前空間のトランスレータ
 * @returns Record mapping workflow status strings to their next-role info
 */
export const getStatusToNextRole = (
  workflowMode: string,
  t: WorkflowT,
): Record<string, NextRoleInfo> => {
  // NOTE: All modes start with the researcher role (research.md is mandatory).
  // The tiers then diverge by ceremony, matching the backend mode tables:
  //   - lightweight (低): research → implement → auto-verify (no plan)
  //   - standard    (中): research → plan → implement → verify
  //   - comprehensive(高): research → plan → implement → verify
  // (The reviewer role at plan_created was retired 2026-08 — plan_created is
  // now purely the approval gate in every mode.)
  const lightweightMode: Record<string, NextRoleInfo> = {
    draft: { role: 'researcher', label: t('runResearch'), icon: Search },
    research_done: { role: 'implementer', label: t('startImplementation'), icon: Code },
    in_progress: {
      role: 'auto_verifier',
      label: t('runAutoVerification'),
      icon: FlaskConical,
    },
  };

  const standardMode: Record<string, NextRoleInfo> = {
    draft: { role: 'researcher', label: t('runResearch'), icon: Search },
    research_done: { role: 'planner', label: t('createPlan'), icon: FileText },
    plan_approved: { role: 'implementer', label: t('startImplementation'), icon: Code },
    in_progress: { role: 'verifier', label: t('runVerification'), icon: FlaskConical },
  };

  // Same phase chain as standard — comprehensive differs in ceremony elsewhere
  // (complexity range), not in the status→role chain.
  const comprehensiveMode: Record<string, NextRoleInfo> = {
    ...standardMode,
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
