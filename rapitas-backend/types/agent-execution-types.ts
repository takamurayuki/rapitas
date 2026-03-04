/**
 * Agent実行関連の型定義
 */
import type { AgentExecution, AgentSession, AIAgentConfig, AgentExecutionLog, GitCommit } from "@prisma/client";

/**
 * Agent実行ステータス
 */
export type AgentExecutionStatus =
  | "pending"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "error"
  | "cancelled";

/**
 * 質問タイプ
 */
export type QuestionType = "tool_call" | "none";

/**
 * アクションタイプ
 */
export type ActionType =
  | "analysis"
  | "implementation"
  | "review"
  | "test"
  | "debug";

/**
 * リクエストタイプ
 */
export type RequestType =
  | "code_review"
  | "task_execution"
  | "analysis_request"
  | "test_execution";

/**
 * 実行タイプ
 */
export type ExecutionType =
  | "code_review"
  | "task_implementation"
  | "analysis"
  | "testing";

/**
 * ログタイプ
 */
export type LogType =
  | "info"
  | "error"
  | "warning"
  | "debug"
  | "output"
  | "command";

/**
 * リアルタイム通信で使用されるイベントタイプ
 */
export type RealtimeEventType =
  | "agent_execution_started"
  | "agent_execution_complete"
  | "agent_execution_resumed"
  | "agent_execution_continued"
  | "agent_error"
  | "pr_review_requested";

/**
 * 実行リクエスト型
 */
export interface ExecutionRequest {
  agentConfigId?: number;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string;
  sessionId?: number;
  attachments?: Array<{ path: string; type?: string }>;
}

/**
 * 実行結果型
 */
export interface ExecutionResult {
  success: boolean;
  executionId: number;
  sessionId: number;
  message: string;
}

/**
 * AgentExecutionの拡張型（関連データを含む）
 */
export interface AgentExecutionWithExtras extends AgentExecution {
  session?: AgentSession;
  agentConfig?: AIAgentConfig | null;
  executionLogs?: AgentExecutionLog[];
  gitCommits?: GitCommit[];
}

/**
 * 実行ログエントリー
 */
export interface ExecutionLogEntry {
  id: number;
  chunk: string;
  type: LogType;
  sequence: number;
  timestamp: Date;
  executionId?: number;
}

/**
 * 質問タイムアウト情報
 */
export interface QuestionTimeoutInfo {
  timeoutAt: Date;
  remainingMs: number;
  isTimeout: boolean;
}

/**
 * 実行ステータス情報
 */
export interface ExecutionStatusInfo {
  id: number;
  taskId: number;
  status: AgentExecutionStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  waitingForInput: boolean;
  question?: string | null;
  questionType: QuestionType;
  questionTimeout?: QuestionTimeoutInfo | null;
  claudeSessionId?: string | null;
  agentConfig?: {
    id: number;
    name: string;
    agentType: string;
  } | null;
  executionLogs?: ExecutionLogEntry[];
}

/**
 * 実行可能タスク情報
 */
export interface ExecutingTaskInfo {
  id: number;
  title: string;
  executionId: number;
  startedAt: Date;
  agentName: string;
  agentType: string;
  status: AgentExecutionStatus;
}

/**
 * 再開可能実行情報
 */
export interface ResumableExecutionInfo {
  id: number;
  taskId: number;
  taskTitle: string;
  status: AgentExecutionStatus;
  startedAt: Date;
  waitingForInput: boolean;
  question?: string | null;
  questionType?: QuestionType | null;
  questionDetails?: string | null;
  claudeSessionId?: string | null;
  agentName: string;
  agentType: string;
}

/**
 * 中断された実行情報
 */
export interface InterruptedExecutionInfo extends ResumableExecutionInfo {
  interruptedAt: Date;
  interruptionReason?: string;
}

/**
 * リアルタイムイベントデータ
 */
export interface RealtimeEventData {
  type: RealtimeEventType;
  taskId: number;
  executionId?: number;
  message?: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * 実行再開リクエスト
 */
export interface ExecutionResumeRequest {
  executionId: number;
  taskId: number;
  userInput?: string;
  continueAutomatically?: boolean;
}

/**
 * 実行停止リクエスト
 */
export interface ExecutionStopRequest {
  executionId: number;
  taskId: number;
  reason?: string;
  graceful?: boolean;
}

/**
 * 実行統計情報
 */
export interface ExecutionStatistics {
  total: number;
  running: number;
  completed: number;
  failed: number;
  waitingForInput: number;
  averageExecutionTimeMs: number;
  successRate: number;
}

/**
 * セッション管理情報
 */
export interface SessionInfo {
  id: string;
  taskId?: number;
  status: "active" | "completed" | "error" | "interrupted";
  startedAt: Date;
  completedAt?: Date;
  agentType: string;
  configId: number;
}

/**
 * 並列実行状況
 */
export interface ParallelExecutionState {
  maxConcurrency: number;
  activeExecutions: number;
  queuedExecutions: number;
  availableSlots: number;
}