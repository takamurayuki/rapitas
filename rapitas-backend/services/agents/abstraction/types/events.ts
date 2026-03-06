/**
 * エージェントイベントシステムの型定義
 */

import type { AgentState } from './agent-identification';
import type { ExecutionMetrics, PendingQuestion, AgentArtifact, GitCommitInfo } from './execution-result';

/**
 * エージェントイベントタイプ
 */
export type AgentEventType =
  | 'state_change'       // 状態変更
  | 'output'             // 出力（ストリーミング）
  | 'error'              // エラー
  | 'tool_start'         // ツール実行開始
  | 'tool_end'           // ツール実行終了
  | 'question'           // 質問発生
  | 'progress'           // 進捗更新
  | 'artifact'           // 成果物生成
  | 'commit'             // Gitコミット
  | 'metrics_update';    // メトリクス更新

/**
 * エージェントイベント基底型
 */
export interface AgentEventBase {
  type: AgentEventType;
  timestamp: Date;
  executionId: string;
  agentId: string;
}

export interface StateChangeEvent extends AgentEventBase {
  type: 'state_change';
  previousState: AgentState;
  newState: AgentState;
  reason?: string;
}

export interface OutputEvent extends AgentEventBase {
  type: 'output';
  content: string;
  isError: boolean;
  isPartial: boolean;
}

export interface ErrorEvent extends AgentEventBase {
  type: 'error';
  error: Error;
  recoverable: boolean;
  context?: string;
}

export interface ToolStartEvent extends AgentEventBase {
  type: 'tool_start';
  toolId: string;
  toolName: string;
  input: unknown;
}

export interface ToolEndEvent extends AgentEventBase {
  type: 'tool_end';
  toolId: string;
  toolName: string;
  output: unknown;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface QuestionEvent extends AgentEventBase {
  type: 'question';
  question: PendingQuestion;
}

export interface ProgressEvent extends AgentEventBase {
  type: 'progress';
  current: number;
  total: number;
  message?: string;
  subtask?: string;
}

export interface ArtifactEvent extends AgentEventBase {
  type: 'artifact';
  artifact: AgentArtifact;
}

export interface CommitEvent extends AgentEventBase {
  type: 'commit';
  commit: GitCommitInfo;
}

export interface MetricsUpdateEvent extends AgentEventBase {
  type: 'metrics_update';
  metrics: Partial<ExecutionMetrics>;
}

/**
 * 全イベント型のユニオン
 */
export type AgentEvent =
  | StateChangeEvent
  | OutputEvent
  | ErrorEvent
  | ToolStartEvent
  | ToolEndEvent
  | QuestionEvent
  | ProgressEvent
  | ArtifactEvent
  | CommitEvent
  | MetricsUpdateEvent;

/**
 * イベントハンドラ型
 */
export type AgentEventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void | Promise<void>;
