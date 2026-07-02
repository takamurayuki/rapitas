/**
 * Workflow role configuration constants and types.
 *
 * @module workflow-role-constants
 */
import type { LucideIcon } from 'lucide-react';
import { Search, FileText, MessageSquare, Code, FlaskConical } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { WorkflowRole } from '@/types';

export type SystemPrompt = {
  key: string;
  name: string;
  category: string;
};

export type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

export type RoleConfigItem = {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
  accentColor: string;
  outputFile: string;
  description: string;
  inputLabel: string;
};

/**
 * Roles where the cross-provider review option is meaningful — i.e. roles
 * that evaluate work produced by an upstream phase. Researcher / planner /
 * implementer have no review semantics so they only see the regular
 * provider preferences.
 */
export const ROLES_SUPPORTING_CROSS_PROVIDER = new Set<WorkflowRole>([
  'reviewer',
  'verifier',
  'auto_verifier',
]);

/**
 * Builds the per-role display config. A function (not a module-level constant)
 * because the labels/descriptions are translated — `t` can only be obtained
 * inside a component via `useTranslations`, not at module scope.
 *
 * @param t - Translator scoped to the `workflow` namespace / workflow名前空間のt
 * @returns Role → display config map / ロールごとの表示設定
 */
export function getRoleConfig(
  t: ReturnType<typeof useTranslations<'workflow'>>,
): Record<WorkflowRole, RoleConfigItem> {
  return {
    researcher: {
      label: t('stepResearch'),
      icon: Search,
      color: 'text-indigo-600 dark:text-indigo-400',
      bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
      borderColor: 'border-indigo-200 dark:border-indigo-800',
      accentColor: 'bg-indigo-600',
      outputFile: 'research.md',
      description: t('roles.researcher.description'),
      inputLabel: t('roles.researcher.inputLabel'),
    },
    planner: {
      label: t('roles.planner.label'),
      icon: FileText,
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
      borderColor: 'border-amber-200 dark:border-amber-800',
      accentColor: 'bg-amber-600',
      outputFile: 'plan.md',
      description: t('roles.planner.description'),
      inputLabel: 'research.md',
    },
    reviewer: {
      label: t('stepReview'),
      icon: MessageSquare,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
      borderColor: 'border-purple-200 dark:border-purple-800',
      accentColor: 'bg-purple-600',
      outputFile: 'question.md',
      description: t('roles.reviewer.description'),
      inputLabel: 'plan.md',
    },
    implementer: {
      label: t('stepImplement'),
      icon: Code,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      borderColor: 'border-green-200 dark:border-green-800',
      accentColor: 'bg-green-600',
      outputFile: t('roles.implementer.outputFile'),
      description: t('roles.implementer.description'),
      inputLabel: 'plan.md + question.md',
    },
    verifier: {
      label: t('stepVerifyFull'),
      icon: FlaskConical,
      color: 'text-emerald-600 dark:text-emerald-400',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
      accentColor: 'bg-emerald-600',
      outputFile: 'verify.md',
      description: t('roles.verifier.description'),
      inputLabel: 'plan.md + diff',
    },
    auto_verifier: {
      label: t('stepVerifyFull'),
      icon: FlaskConical,
      color: 'text-teal-600 dark:text-teal-400',
      bgColor: 'bg-teal-50 dark:bg-teal-900/20',
      borderColor: 'border-teal-200 dark:border-teal-800',
      accentColor: 'bg-teal-600',
      outputFile: 'verify.md',
      description: t('roles.autoVerifier.description'),
      inputLabel: 'plan.md + diff',
    },
  };
}

export const ROLE_ORDER: WorkflowRole[] = [
  'researcher',
  'planner',
  'reviewer',
  'implementer',
  'verifier',
];
