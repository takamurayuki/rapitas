/**
 * Parallel Execution System Type Definitions
 *
 * Data structures for subtask dependency analysis and parallel execution.
 */

/**
 * Task priority
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Parallel execution status
 */
export type ParallelExecutionStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked' // Blocked by incomplete dependencies
  | 'waiting_for_input';

/**
 * Dependency types
 */
export type DependencyType =
  | 'file_sharing'
  | 'data_flow'
  | 'sequential' // Explicit ordering dependency
  | 'resource' // Resource contention
  | 'logical';

/**
 * Dependency edge (represents inter-task dependencies)
 */
export type DependencyEdge = {
  fromTaskId: number;
  toTaskId: number;
  type: DependencyType;
  weight: number; // Dependency strength (0-100)
  sharedResources: string[]; // Shared resources (file paths etc.)
  description?: string;
};

/**
 * Task node (node in the dependency graph)
 */
export type TaskNode = {
  id: number;
  title: string;
  description?: string;
  priority: TaskPriority;
  estimatedHours: number;
  actualHours?: number;
  status: ParallelExecutionStatus;

  // Dependencies
  dependencies: number[]; // Task IDs this task depends on
  dependents: number[]; // Task IDs that depend on this task

  // Analysis results
  depth: number; // Depth in graph (for critical path calculation)
  independenceScore: number; // Independence score (0-100)
  parallelizability: number; // Parallelizability score (0-100)

  // Execution info
  executionId?: number;
  agentId?: string;
  startedAt?: Date;
  completedAt?: Date;

  // Metadata
  files: string[]; // Related files
  tags: string[];
};

/**
 * Dependency tree map
 */
export type DependencyTreeMap = {
  nodes: Map<number, TaskNode>;
  edges: DependencyEdge[];

  // Computed metrics
  criticalPath: number[]; // Task IDs on the critical path
  parallelGroups: ParallelGroup[];
  maxDepth: number;
  totalWeight: number;
};

/**
 * Parallel execution group
 */
export type ParallelGroup = {
  groupId: number;
  level: number; // Execution level (starting from 0)
  taskIds: number[];
  canRunParallel: boolean;
  estimatedDuration: number;

  // Intra-group dependencies
  internalDependencies: DependencyEdge[];

  // Dependencies on other groups
  dependsOnGroups: number[];
};

/**
 * Parallel execution plan
 */
export type ParallelExecutionPlan = {
  id: string;
  parentTaskId: number;
  createdAt: Date;

  // Execution structure
  groups: ParallelGroup[];
  executionOrder: number[][]; // Task ID arrays by level

  // Estimates
  estimatedTotalDuration: number;
  estimatedSequentialDuration: number;
  parallelEfficiency: number; // Efficiency gain from parallelization

  // Constraints
  maxConcurrency: number; // Max concurrent execution count
  resourceConstraints: ResourceConstraint[];
};

/**
 * Resource constraints
 */
export type ResourceConstraint = {
  type: 'file' | 'api' | 'memory' | 'cpu';
  resource: string;
  maxConcurrent: number;
  affectedTasks: number[];
};

/**
 * Sub-agent state
 */
export type SubAgentState = {
  agentId: string;
  taskId: number;
  executionId: number;
  status: ParallelExecutionStatus;
  startedAt: Date;
  lastActivityAt: Date;
  watingForInput: boolean;

  // Output
  output: string;
  artifacts: string[];

  // Metrics
  tokensUsed: number;
  executionTimeMs: number;
};

/**
 * Parallel execution session
 */
export type ParallelExecutionSession = {
  sessionId: string;
  parentTaskId: number;
  plan: ParallelExecutionPlan;

  // Execution state
  status: ParallelExecutionStatus;
  currentLevel: number;
  activeAgents: Map<string, SubAgentState>;
  completedTasks: number[];
  failedTasks: number[];

  // Execution context (needed for next batch execution)
  nodes: Map<number, TaskNode>;
  workingDirectory: string;

  /** Maps taskId to its git branch name for trial merge after completion. */
  taskBranches: Map<number, string>;

  // Timing
  startedAt: Date;
  lastActivityAt: Date;
  completedAt?: Date;

  // Statistics
  totalTokensUsed: number;
  totalExecutionTimeMs: number;
};

/**
 * Inter-agent message
 */
export type AgentMessage = {
  id: string;
  timestamp: Date;
  fromAgentId: string;
  toAgentId: string | 'broadcast';

  type: AgentMessageType;
  payload: unknown;

  // Tracking
  correlationId?: string;
  replyToId?: string;
};

/**
 * Agent message types
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
  | 'coordination_response'
  | 'conflict_detected'
  | 'safety_report_ready';

/**
 * Execution log entry
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
 * Parallel execution configuration
 */
export type ParallelExecutionConfig = {
  maxConcurrentAgents: number;
  questionTimeoutSeconds: number;
  taskTimeoutSeconds: number;
  retryOnFailure: boolean;
  maxRetries: number;
  logSharing: boolean;
  coordinationEnabled: boolean;

  // Safety system options
  /** Enable conflict detection and merge validation. Default: true */
  safetyCheckEnabled?: boolean;
  /** Polling interval for conflict detection in ms. Default: 10000 */
  conflictPollingIntervalMs?: number;
  /** Pause execution when a critical conflict is detected. Default: false */
  pauseOnCriticalConflict?: boolean;
  /** Run trial merge after session completion. Default: true */
  runTrialMerge?: boolean;
  /** Run regression risk detection after session completion. Default: true */
  runRegressionCheck?: boolean;
};

/**
 * Dependency analysis input
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
 * Dependency analysis result
 */
export type DependencyAnalysisResult = {
  treeMap: DependencyTreeMap;
  plan: ParallelExecutionPlan;
  recommendations: string[];
  warnings: string[];
};
