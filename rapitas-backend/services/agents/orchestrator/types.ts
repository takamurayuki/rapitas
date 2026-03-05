/**
 * オーケストレーター共通型定義
 * 循環依存を防ぐため、全モジュールで使用する型をここに集約
 */
import { PrismaClient } from "@prisma/client";
export type PrismaClientInstance = InstanceType<typeof PrismaClient>;

import type {
  AgentOutputHandler,
  AgentStatus,
  TaskAnalysisInfo,
  BaseAgent,
} from "../base-agent";
import type { QuestionKey } from "../question-detection";
import type { ExecutionFileLogger } from "../execution-file-logger";
import type { AgentConfigInput } from "../agent-factory";

export type ExecutionOptions = {
  taskId: number;
  sessionId: number;
  agentConfigId?: number;
  workingDirectory?: string;
  timeout?: number;
  requireApproval?: boolean;
  onOutput?: AgentOutputHandler;
  /** AIタスク分析結果（有効な場合に渡される） */
  analysisInfo?: TaskAnalysisInfo;
  /** 前回の実行からの継続であることを示すフラグ */
  continueFromPrevious?: boolean;
  branchName?: string;
};

export type ExecutionState = {
  executionId: number;
  sessionId: number;
  agentId: string;
  taskId: number;
  status: AgentStatus;
  startedAt: Date;
  output: string;
};

export type OrchestratorEvent = {
  type:
    | "execution_started"
    | "execution_output"
    | "execution_completed"
    | "execution_failed"
    | "execution_cancelled";
  executionId: number;
  sessionId: number;
  taskId: number;
  data?: unknown;
  timestamp: Date;
};

export type EventListener = (event: OrchestratorEvent) => void;

/**
 * アクティブなエージェントの追跡情報
 */
export type ActiveAgentInfo = {
  agent: BaseAgent;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  lastOutput: string;
  lastSavedAt: Date;
  fileLogger?: ExecutionFileLogger;
};

/**
 * オーケストレーターの共有コンテキスト
 * 各モジュールが必要とする共有状態とメソッドへのアクセスを提供
 */
export type OrchestratorContext = {
  prisma: PrismaClientInstance;
  activeExecutions: Map<number, ExecutionState>;
  activeAgents: Map<number, ActiveAgentInfo>;
  isShuttingDown: boolean;
  serverStartedAt: Date;
  emitEvent: (event: OrchestratorEvent) => void;
  startQuestionTimeout: (
    executionId: number,
    taskId: number,
    questionKey?: QuestionKey,
  ) => void;
  cancelQuestionTimeout: (executionId: number) => void;
  getQuestionTimeoutInfo: (
    executionId: number,
  ) => {
    remainingSeconds: number;
    deadline: Date;
    questionKey?: QuestionKey;
  } | null;
  tryAcquireContinuationLock: (
    executionId: number,
    source: "user_response" | "auto_timeout",
  ) => boolean;
  releaseContinuationLock: (executionId: number) => void;
  buildAgentConfigFromDb: (
    dbConfig: {
      id: number;
      agentType: string;
      name: string;
      apiKeyEncrypted: string | null;
      endpoint: string | null;
      modelId: string | null;
    },
    options: { workingDirectory?: string; timeout?: number },
  ) => AgentConfigInput;
};
