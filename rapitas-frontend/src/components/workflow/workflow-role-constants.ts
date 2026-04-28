/**
 * Workflow role configuration constants and types.
 *
 * @module workflow-role-constants
 */
import type { LucideIcon } from 'lucide-react';
import { Search, FileText, MessageSquare, Code, CheckCircle, ShieldCheck } from 'lucide-react';
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

export const ROLE_CONFIG: Record<WorkflowRole, RoleConfigItem> = {
  researcher: {
    label: 'リサーチャー',
    icon: Search,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    accentColor: 'bg-blue-600',
    outputFile: 'research.md',
    description: 'コードベースを調査し、影響範囲・依存関係を分析',
    inputLabel: 'タスク情報',
  },
  planner: {
    label: 'プランナー',
    icon: FileText,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    accentColor: 'bg-amber-600',
    outputFile: 'plan.md',
    description: '調査結果を基にチェックリスト形式の実装計画を作成',
    inputLabel: 'research.md',
  },
  reviewer: {
    label: 'レビュアー',
    icon: MessageSquare,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
    accentColor: 'bg-purple-600',
    outputFile: 'question.md',
    description: '計画のリスク・不明点・改善提案を指摘',
    inputLabel: 'plan.md',
  },
  implementer: {
    label: '実装者',
    icon: Code,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    accentColor: 'bg-green-600',
    outputFile: 'コード',
    description: '承認された計画に従いコードを実装',
    inputLabel: 'plan.md + question.md',
  },
  verifier: {
    label: '検証者',
    icon: CheckCircle,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    accentColor: 'bg-emerald-600',
    outputFile: 'verify.md',
    description: '実装結果を検証しレポートを作成',
    inputLabel: 'plan.md + diff',
  },
  auto_verifier: {
    label: '自動検証',
    icon: ShieldCheck,
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-50 dark:bg-teal-900/20',
    borderColor: 'border-teal-200 dark:border-teal-800',
    accentColor: 'bg-teal-600',
    outputFile: 'verify.md',
    description: '実装結果を自動で検証しレポートを作成',
    inputLabel: 'plan.md + diff',
  },
};

export const ROLE_ORDER: WorkflowRole[] = [
  'researcher',
  'planner',
  'reviewer',
  'implementer',
  'verifier',
];
