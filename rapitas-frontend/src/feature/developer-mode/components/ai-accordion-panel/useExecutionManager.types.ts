/**
 * useExecutionManager.types
 *
 * Public option/result types for `useExecutionManager`. Extracted into their
 * own file because they constitute ~90 lines of pure type declarations and
 * were inflating the hook body past the 500-line per-file limit.
 *
 * The hook itself, the helpers, and any consumer all import from here so
 * there is exactly one source of truth for the surface.
 */
import type { ExecutionResult, ExecutionStatus } from '../../hooks/useDeveloperMode';
import type { Resource } from '@/types';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';
import type { AccordionSection } from './types';

export type UseExecutionManagerOptions = {
  taskId: number;
  taskTitle: string;
  taskDescription?: string | null;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  optimizedPrompt?: string | null;
  agentConfigId?: number | null;
  resources?: Resource[];
  useTaskAnalysis?: boolean;
  subtasks?: { id: number; title: string }[];
  isParallelExecutionRunning?: boolean;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    baseBranch?: string;
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
  onStartParallelExecution?: (config?: { maxConcurrentAgents?: number }) => Promise<string | null>;
  setExpandedSection: (section: AccordionSection | null) => void;
};

/** Why a stop was not clean, for the panel to translate and show. */
export interface StopNotice {
  /** `failed`: nothing was stopped. `reset_failed`: stopped, status stuck. */
  kind: 'failed' | 'reset_failed';
  /** The backend's own explanation, when it sent one. */
  serverMessage?: string;
}

export type UseExecutionManagerResult = {
  // Log sources
  logs: string[];
  showLogs: boolean;
  setShowLogs: (v: boolean) => void;
  clearLogs: () => void;
  // Form fields
  instruction: string;
  setInstruction: (v: string) => void;
  branchName: string;
  setBranchName: (v: string) => void;
  baseBranch: string;
  setBaseBranch: (v: string) => void;
  baseBranches: string[];
  isGeneratingBranchName: boolean;
  userResponse: string;
  setUserResponse: (v: string) => void;
  isSendingResponse: boolean;
  continueInstruction: string;
  setContinueInstruction: (v: string) => void;
  // Session / restore
  sessionId: number | null;
  isRestoring: boolean;
  // Execution status flags
  isRunning: boolean;
  /** True while a stop request is in flight; the request is awaited now. */
  isStopping: boolean;
  /**
   * Set when a stop did not fully succeed (#1330 review). Null on a clean
   * stop. A code rather than a sentence, so the panel translates it — the
   * optional server message is the backend's own wording when it sent one.
   */
  stopNotice: StopNotice | null;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isWaitingForInput: boolean | null | undefined;
  logViewerStatus: ExecutionLogStatus;
  hasQuestion: boolean;
  question: string;
  questionType: string;
  questionDetails?: {
    options?: Array<{ label: string; description?: string }>;
    headers?: string[];
    multiSelect?: boolean;
  } | null;
  pollingSessionMode: string | null | undefined;
  isSseConnected: boolean;
  // Handlers
  handleExecute: () => Promise<void>;
  handleGenerateBranchName: () => Promise<void>;
  handleSendResponse: () => Promise<void>;
  handleStopExecution: () => Promise<void>;
  handleReset: () => void;
  handleRerunExecution: () => Promise<void>;
  handleContinueExecution: () => Promise<void>;
};
