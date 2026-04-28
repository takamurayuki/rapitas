/**
 * AIAccordionPanel Types
 *
 * Shared type definitions for the AIAccordionPanel feature and its sub-components.
 * Does not contain runtime logic — types only.
 */

import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  Resource,
  Task,
  AIAgentConfig,
} from '@/types';
import type { ExecutionStatus, ExecutionResult } from '../../hooks/useDeveloperMode';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';

export type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category:
    | 'scope'
    | 'technical'
    | 'requirements'
    | 'constraints'
    | 'integration'
    | 'testing'
    | 'deliverables';
};

export type PromptResult = {
  optimizedPrompt: string;
  promptQuality: { score: number };
  hasQuestions: boolean;
  clarificationQuestions?: PromptClarificationQuestion[];
};

export type AccordionSection = 'analysis' | 'execution' | 'terminal';
export type AnalysisTabType = 'subtasks' | 'prompt';

export type AIAccordionPanelProps = {
  /** When true, omit the outer card wrapper (used inside a unified container). */
  embedded?: boolean;
  taskId: number;
  taskTitle: string;
  taskDescription?: string | null;
  // AIAnalysisPanel props
  config: DeveloperModeConfig | null;
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  onAnalyze: () => Promise<void>;
  onApprove: (approvalId: number) => Promise<void>;
  onReject: (approvalId: number, reason: string) => Promise<void>;
  onApproveSubtasks: (selectedIndices?: number[]) => Promise<unknown>;
  isApproving: boolean;
  onOpenSettings: () => void;
  onPromptGenerated?: (prompt: string) => void;
  onSubtasksCreated?: () => void;
  // AgentExecutionPanel props
  showAgentPanel: boolean;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  resources?: Resource[];
  agentConfigId?: number | null;
  agents?: AIAgentConfig[];
  onAgentChange?: (agentId: number) => void;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
    sessionId?: number;
    attachments?: Array<{
      id: number;
      title: string;
      type: string;
      fileName?: string;
      filePath?: string;
      mimeType?: string;
      description?: string;
    }>;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  onStopExecution?: () => void;
  onExecutionComplete?: () => void;
  // Parallel execution
  subtasks?: Task[];
  onStartParallelExecution?: (config?: { maxConcurrentAgents?: number }) => Promise<string | null>;
  isParallelExecutionRunning?: boolean;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  // Parallel execution logs
  parallelSessionId?: string | null;
  subtaskLogs?: Map<number, { logs: Array<{ timestamp: string; message: string; level: string }> }>;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
};
