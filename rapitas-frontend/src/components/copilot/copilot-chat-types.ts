/**
 * Copilot Chat Types and Constants
 *
 * Type definitions for the copilot panel. The free-text quick-prompts were
 * removed when the panel became a rule-based next-action recommender.
 */
import type { NextActionContext } from './next-action-recommender';

export interface CopilotChatPanelProps {
  taskId?: number;
  taskTitle?: string;
  taskStatus?: string;
  taskDescription?: string | null;
  onTaskUpdated?: () => void;
  className?: string;
  embedded?: boolean;
  /** Task state the "next action" recommender reasons over. */
  nextActionContext?: NextActionContext;
  /** Content rendered below the recommendations, inside the same card (e.g. execution accordion). */
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

