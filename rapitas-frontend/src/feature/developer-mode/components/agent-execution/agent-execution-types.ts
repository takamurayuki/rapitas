/**
 * agentExecutionTypes
 *
 * Shared TypeScript types for the agent-execution component split.
 * Kept separate to allow importing types without pulling in React hooks.
 */

import type React from 'react';
import type {
  ExecutionStatus,
  ExecutionResult,
} from '../../hooks/useDeveloperMode';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';
import type { AgentExecutionHandlers } from './useAgentExecutionHandlers';

// NOTE: pattern_match is deprecated; only explicit AI agent status is trusted
export type QuestionType = 'tool_call' | 'none';

export type PrState = {
  status:
    | 'idle'
    | 'creating_pr'
    | 'pr_created'
    | 'merging'
    | 'merged'
    | 'error';
  prUrl?: string;
  prNumber?: number;
  error?: string;
};

export type UseAgentExecutionProps = {
  taskId: number;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  error: string | null;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  agentConfigId?: number | null;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
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
  subtasks?: Task[];
  parallelSessionId?: string | null;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
};

export type UseAgentExecutionReturn = AgentExecutionHandlers & {
  isExpanded: boolean;
  setIsExpanded: (v: boolean) => void;
  showOptions: boolean;
  setShowOptions: (v: boolean) => void;
  selectedAgentId: number | null;
  setSelectedAgentId: (id: number | null) => void;
  instruction: string;
  setInstruction: (v: string) => void;
  branchName: string;
  setBranchName: (v: string) => void;
  userResponse: string;
  setUserResponse: (v: string) => void;
  isSendingResponse: boolean;
  followUpInstruction: string;
  setFollowUpInstruction: (v: string) => void;
  followUpError: string | null;
  setFollowUpError: (v: string | null) => void;
  sessionId: number | null;
  prState: PrState;
  /** NOTE: Accepts either a new PrState or a functional update for partial merges */
  setPrState: React.Dispatch<React.SetStateAction<PrState>>;
  timeoutCountdown: number | null;
  logs: string[];
  isSseConnected: boolean;
  pollingTokensUsed: number | undefined;
  pollingSessionMode: string | undefined;
  isRunning: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean;
  isWaitingForInput: boolean;
  logViewerStatus: ExecutionLogStatus;
  hasQuestion: boolean;
  question: string;
  questionType: QuestionType;
  questionParsed: { text: string; options: string[] } | null;
  hasOptions: boolean;
  isConfirmedQuestion: boolean;
  hasSubtaskTabs: boolean;
};
