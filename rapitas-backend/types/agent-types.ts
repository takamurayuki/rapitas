/**
 * Agent関連の型定義
 */
import type { AIAgentConfig, AgentExecution } from "@prisma/client";
import type { TaskPriority } from "../services/parallel-execution/types";

/**
 * AgentExecution に question/questionType/questionDetails/claudeSessionId が
 * DB 上は存在するが Prisma の型定義に含まれないケースを安全にキャストするための型
 */
export type ExecutionWithExtras = AgentExecution & {
  question?: string | null;
  questionType?: string | null;
  questionDetails?: string | null;
  claudeSessionId?: string | null;
};

/**
 * エージェント設定の検証結果
 */
export interface AgentConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * エージェント接続テストの結果
 */
export interface AgentConnectionTestResult {
  success: boolean;
  message: string;
  responseTime?: number;
  error?: string;
}

/**
 * エージェント診断情報
 */
export interface AgentDiagnostics {
  totalAgents: number;
  activeAgents: number;
  executingTasks: number;
  pendingTasks: number;
  systemLoad: {
    cpu: number;
    memory: number;
  };
  diskSpace: {
    total: number;
    used: number;
    available: number;
  };
}

/**
 * エージェント型情報
 */
export interface AgentTypeInfo {
  type: string;
  name: string;
  description: string;
  configSchema: Record<string, any>;
  supportedModels: string[];
}

/**
 * エージェントモデル情報
 */
export interface AgentModelInfo {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  costPer1kTokens: number;
  capabilities: string[];
}

/**
 * エージェント暗号化ステータス
 */
export interface EncryptionStatus {
  isConfigured: boolean;
  algorithm: string;
  keyLength: number;
  lastRotation?: Date;
}

/**
 * エージェント設定変更のログ情報
 */
export interface AgentConfigChange {
  field: string;
  oldValue: any;
  newValue: any;
  changeType: "created" | "updated" | "deleted";
}