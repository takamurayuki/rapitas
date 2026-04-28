/**
 * Copilot Chat Types and Constants
 *
 * Type definitions and quick prompt configurations for the copilot chat panel.
 */
import { Sparkles, ListTodo, AlertTriangle, Clock, Play, Lightbulb } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface CopilotChatPanelProps {
  taskId?: number;
  taskTitle?: string;
  taskStatus?: string;
  taskDescription?: string | null;
  onTaskUpdated?: () => void;
  className?: string;
  embedded?: boolean;
  /** Content rendered below the input bar, inside the same card (e.g. execution accordion). */
  children?: React.ReactNode;
}

export type AnalysisData = {
  summary: string;
  complexity: string;
  estimatedTotalHours: number;
  suggestedSubtasks: Array<{
    title: string;
    description?: string;
    priority: string;
    estimatedHours?: number;
  }>;
};

export type QuickPromptItem = {
  icon: LucideIcon;
  label: string;
  prompt?: string;
  action?: 'analyze' | 'execute';
  isAction?: boolean;
};

export const QUICK_PROMPTS: QuickPromptItem[] = [
  {
    icon: Sparkles,
    label: 'AI分析',
    action: 'analyze',
    isAction: true,
  },
  {
    icon: ListTodo,
    label: 'サブタスク分解',
    prompt: 'このタスクを具体的なサブタスクに分解してください',
  },
  {
    icon: AlertTriangle,
    label: 'リスク分析',
    prompt: 'このタスクの潜在的なリスクと対策を教えてください',
  },
  {
    icon: Clock,
    label: '工数見積もり',
    prompt: 'このタスクの実装工数を見積もってください',
  },
  {
    icon: Play,
    label: 'エージェント実行',
    action: 'execute',
    isAction: true,
  },
  {
    icon: Lightbulb,
    label: 'アプローチ提案',
    prompt: 'このタスクの最適なアプローチを提案してください',
  },
];
