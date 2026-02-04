/**
 * 並列実行システムの型定義
 * サブタスクの依存関係分析と並列実行のためのデータ構造
 */

/**
 * タスク優先度
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * 並列実行ステータス
 */
export type ParallelExecutionStatus =
  | 'pending'       // 待機中
  | 'scheduled'     // スケジュール済み
  | 'running'       // 実行中
  | 'completed'     // 完了
  | 'failed'        // 失敗
  | 'cancelled'     // キャンセル
  | 'blocked';      // ブロック（依存タスク未完了）

/**
 * 依存関係の種類
 */
export type DependencyType =
  | 'file_sharing'     // ファイル共有による依存
  | 'data_flow'        // データフローによる依存
  | 'sequential'       // 順序依存（明示的）
  | 'resource'         // リソース競合
  | 'logical';         // 論理的な依存関係

/**
 * 依存関係エッジ（タスク間の依存を表現）
 */
export type DependencyEdge = {
  fromTaskId: number;
  toTaskId: number;
  type: DependencyType;
  weight: number;          // 依存の強度 (0-100)
  sharedResources: string[]; // 共有リソース（ファイルパス等）
  description?: string;
};

/**
 * タスクノード（依存関係グラフのノード）
 */
export type TaskNode = {
  id: number;
  title: string;
  description?: string;
  priority: TaskPriority;
  estimatedHours: number;
  actualHours?: number;
  status: ParallelExecutionStatus;

  // 依存関係
  dependencies: number[];      // このタスクが依存するタスクID
  dependents: number[];        // このタスクに依存するタスクID

  // 分析結果
  depth: number;               // グラフ内の深さ（クリティカルパス計算用）
  independenceScore: number;   // 独立性スコア (0-100)
  parallelizability: number;   // 並列実行可能性スコア (0-100)

  // 実行情報
  executionId?: number;
  agentId?: string;
  startedAt?: Date;
  completedAt?: Date;

  // メタデータ
  files: string[];             // 関連ファイル
  tags: string[];
};

/**
 * 依存関係ツリーマップ
 */
export type DependencyTreeMap = {
  nodes: Map<number, TaskNode>;
  edges: DependencyEdge[];

  // 計算済みメトリクス
  criticalPath: number[];      // クリティカルパスのタスクID
  parallelGroups: ParallelGroup[];
  maxDepth: number;
  totalWeight: number;
};

/**
 * 並列実行グループ
 */
export type ParallelGroup = {
  groupId: number;
  level: number;               // 実行レベル（0から始まる）
  taskIds: number[];
  canRunParallel: boolean;
  estimatedDuration: number;

  // グループ内の依存関係
  internalDependencies: DependencyEdge[];

  // 他のグループへの依存
  dependsOnGroups: number[];
};

/**
 * 並列実行プラン
 */
export type ParallelExecutionPlan = {
  id: string;
  parentTaskId: number;
  createdAt: Date;

  // 実行構造
  groups: ParallelGroup[];
  executionOrder: number[][];  // レベルごとのタスクID配列

  // 推定値
  estimatedTotalDuration: number;
  estimatedSequentialDuration: number;
  parallelEfficiency: number;  // 並列化による効率向上率

  // 制約
  maxConcurrency: number;      // 最大同時実行数
  resourceConstraints: ResourceConstraint[];
};

/**
 * リソース制約
 */
export type ResourceConstraint = {
  type: 'file' | 'api' | 'memory' | 'cpu';
  resource: string;
  maxConcurrent: number;
  affectedTasks: number[];
};

/**
 * サブエージェントの状態
 */
export type SubAgentState = {
  agentId: string;
  taskId: number;
  executionId: number;
  status: ParallelExecutionStatus;
  startedAt: Date;
  lastActivityAt: Date;

  // 出力
  output: string;
  artifacts: string[];

  // メトリクス
  tokensUsed: number;
  executionTimeMs: number;
};

/**
 * 並列実行セッション
 */
export type ParallelExecutionSession = {
  sessionId: string;
  parentTaskId: number;
  plan: ParallelExecutionPlan;

  // 実行状態
  status: ParallelExecutionStatus;
  currentLevel: number;
  activeAgents: Map<string, SubAgentState>;
  completedTasks: number[];
  failedTasks: number[];

  // 実行コンテキスト（次のバッチ実行に必要）
  nodes: Map<number, TaskNode>;
  workingDirectory: string;

  // タイミング
  startedAt: Date;
  lastActivityAt: Date;
  completedAt?: Date;

  // 統計
  totalTokensUsed: number;
  totalExecutionTimeMs: number;
};

/**
 * エージェント間メッセージ
 */
export type AgentMessage = {
  id: string;
  timestamp: Date;
  fromAgentId: string;
  toAgentId: string | 'broadcast';

  type: AgentMessageType;
  payload: unknown;

  // 追跡
  correlationId?: string;
  replyToId?: string;
};

/**
 * エージェントメッセージの種類
 */
export type AgentMessageType =
  | 'task_started'
  | 'task_progress'
  | 'task_completed'
  | 'task_failed'
  | 'file_modified'
  | 'resource_locked'
  | 'resource_released'
  | 'dependency_resolved'
  | 'coordination_request'
  | 'coordination_response';

/**
 * 実行ログエントリ
 */
export type ExecutionLogEntry = {
  timestamp: Date;
  agentId: string;
  taskId: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
};

/**
 * 並列実行の設定
 */
export type ParallelExecutionConfig = {
  maxConcurrentAgents: number;
  questionTimeoutSeconds: number;
  taskTimeoutSeconds: number;
  retryOnFailure: boolean;
  maxRetries: number;
  logSharing: boolean;
  coordinationEnabled: boolean;
};

/**
 * 依存関係分析の入力
 */
export type DependencyAnalysisInput = {
  parentTaskId: number;
  subtasks: Array<{
    id: number;
    title: string;
    description?: string;
    priority: TaskPriority;
    estimatedHours?: number;
    files?: string[];
    explicitDependencies?: number[];
  }>;
  config?: Partial<ParallelExecutionConfig>;
};

/**
 * 依存関係分析の結果
 */
export type DependencyAnalysisResult = {
  treeMap: DependencyTreeMap;
  plan: ParallelExecutionPlan;
  recommendations: string[];
  warnings: string[];
};
