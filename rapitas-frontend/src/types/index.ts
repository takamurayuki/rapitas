export type Theme = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  // 開発プロジェクト設定
  isDevelopment?: boolean;
  repositoryUrl?: string | null;
  workingDirectory?: string | null;
  defaultBranch?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
  };
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
    milestones: number;
  };
};

export type Milestone = {
  id: number;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  projectId: number;
  project?: Project;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
  };
};

export type Priority = "low" | "medium" | "high" | "urgent";

export type Status = "todo" | "in-progress" | "done";

export type Label = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
};

export type TaskLabel = {
  id: number;
  taskId: number;
  labelId: number;
  label?: Label;
  createdAt: string;
};

export type ExamGoal = {
  id: number;
  name: string;
  description?: string | null;
  examDate: string;
  targetScore?: string | null;
  color: string;
  icon?: string | null;
  isCompleted: boolean;
  actualScore?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
};

export type StudyStreak = {
  id: number;
  date: string;
  studyMinutes: number;
  tasksCompleted: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyPlanPhase = {
  name: string;
  days: number;
  tasks: string[];
  dailyHours: number;
};

export type GeneratedStudyPlan = {
  subject: string;
  targetScore?: string;
  totalDays: number;
  studyHoursPerDay: number;
  phases: StudyPlanPhase[];
  tips: string[];
};

export type StudyPlan = {
  id: number;
  examGoalId?: number | null;
  subject: string;
  prompt: string;
  generatedPlan: GeneratedStudyPlan;
  totalDays: number;
  startDate: string;
  endDate: string;
  isApplied: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: Status;
  priority: Priority;
  labels?: string[];
  taskLabels?: TaskLabel[];
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: string | null;
  subject?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  parentId?: number | null;
  parent?: Task;
  subtasks?: Task[];
  themeId?: number | null;
  theme?: Theme | null;
  projectId?: number | null;
  project?: Project | null;
  milestoneId?: number | null;
  milestone?: Milestone | null;
  examGoalId?: number | null;
  examGoal?: ExamGoal | null;
  timeEntries?: TimeEntry[];
  comments?: Comment[];
  // タスク設定関連
  isDeveloperMode?: boolean;
  isAiTaskAnalysis?: boolean;
  agentGenerated?: boolean;
  agentExecutable?: boolean;
  executionInstructions?: string | null;
  developerModeConfig?: DeveloperModeConfig | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeEntry = {
  id: number;
  taskId: number;
  duration: number;
  breakDuration?: number | null;
  note?: string | null;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: number;
  taskId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityLogChanges = Record<string, unknown>;
export type ActivityLogMetadata = Record<string, unknown>;

export type ActivityLog = {
  id: number;
  taskId?: number | null;
  projectId?: number | null;
  action: string;
  changes?: ActivityLogChanges;
  metadata?: ActivityLogMetadata;
  createdAt: string;
};

export const priorityColors = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-800 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-300",
};

export const priorityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "緊急",
};

// 実績/バッジ
export type AchievementCondition = {
  type: string;
  value?: number;
  count?: number;
  threshold?: number;
  [key: string]: unknown;
};

export type Achievement = {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  condition: AchievementCondition;
  rarity: "common" | "rare" | "epic" | "legendary";
  isUnlocked: boolean;
  unlockedAt: string | null;
  createdAt: string;
};

// 習慣
export type Habit = {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  color: string;
  frequency: string;
  targetCount: number;
  isActive: boolean;
  logs?: HabitLog[];
  _count?: { logs: number };
  createdAt: string;
  updatedAt: string;
};

export type HabitLog = {
  id: number;
  habitId: number;
  date: string;
  count: number;
  note?: string | null;
  createdAt: string;
};

// 学習リソース
export type Resource = {
  id: number;
  taskId?: number | null;
  title: string;
  url?: string | null;
  type: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

// フラッシュカード
export type FlashcardDeck = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  taskId?: number | null;
  cards?: Flashcard[];
  _count?: { cards: number };
  createdAt: string;
  updatedAt: string;
};

export type Flashcard = {
  id: number;
  deckId: number;
  front: string;
  back: string;
  nextReview?: string | null;
  interval: number;
  easeFactor: number;
  reviewCount: number;
  deck?: FlashcardDeck;
  createdAt: string;
  updatedAt: string;
};

// タスクテンプレート
export type TaskTemplateData = {
  title?: string;
  description?: string;
  estimatedHours?: number;
  priority?: Priority;
  labels?: string[];
  subtasks?: Array<{
    title: string;
    description?: string;
    estimatedHours?: number;
  }>;
  [key: string]: unknown;
};

export type TaskTemplate = {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  templateData: TaskTemplateData;
  isPublic: boolean;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

// 週次レポート
export type WeeklyReport = {
  period: {
    start: string;
    end: string;
  };
  summary: {
    tasksCompleted: number;
    studyHours: number;
    tasksChange: number;
    hoursChange: number;
  };
  dailyData: {
    date: string;
    tasks: number;
    hours: number;
  }[];
  subjectBreakdown: {
    subject: string | null;
    count: number;
  }[];
};

// ==================== 開発者モード関連 ====================

export type DeveloperModeConfig = {
  id: number;
  taskId: number;
  isEnabled: boolean;
  autoApprove: boolean;
  notifyInApp: boolean;
  maxSubtasks: number;
  priority: "aggressive" | "balanced" | "conservative";
  createdAt: string;
  updatedAt: string;
  agentSessions?: AgentSession[];
  approvalRequests?: ApprovalRequest[];
};

export type AgentSessionMetadata = {
  workingDirectory?: string;
  branchName?: string;
  instruction?: string;
  [key: string]: unknown;
};

export type AgentSession = {
  id: number;
  configId: number;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  startedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt: string;
  totalTokensUsed: number;
  errorMessage?: string | null;
  metadata?: AgentSessionMetadata;
  agentActions?: AgentAction[];
  createdAt: string;
  updatedAt: string;
};

export type AgentActionInput = {
  command?: string;
  args?: string[];
  content?: string;
  [key: string]: unknown;
};

export type AgentActionOutput = {
  result?: string;
  files?: string[];
  error?: string;
  [key: string]: unknown;
};

export type AgentAction = {
  id: number;
  sessionId: number;
  actionType: string;
  targetTaskId?: number | null;
  input?: AgentActionInput;
  output?: AgentActionOutput;
  tokensUsed: number;
  durationMs?: number | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
};

export type SubtaskProposal = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority: Priority;
  order: number;
  dependencies?: number[];
};

export type TaskAnalysisResult = {
  summary: string;
  complexity: "simple" | "medium" | "complex";
  estimatedTotalHours: number;
  suggestedSubtasks: SubtaskProposal[];
  reasoning: string;
  tips?: string[];
};

export type ApprovalRequest = {
  id: number;
  configId: number;
  config?: DeveloperModeConfig & { task?: Task };
  requestType: "subtask_creation" | "task_execution" | "task_completion" | "code_review";
  title: string;
  description?: string | null;
  proposedChanges: {
    subtasks?: SubtaskProposal[];
    reasoning?: string;
    tips?: string[];
    complexity?: string;
    estimatedTotalHours?: number;
    workingDirectory?: string;
    files?: string[];
    // コードレビュー用の追加フィールド
    structuredDiff?: FileDiff[];
    implementationSummary?: string;
    executionTimeMs?: number;
  };
  estimatedChanges?: {
    diff?: string;
    filesChanged?: number;
    summary?: string;
  } | null;
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  notificationSent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NotificationMetadata = {
  approvalId?: number;
  taskId?: number;
  errorDetails?: string;
  [key: string]: unknown;
};

export type Notification = {
  id: number;
  type: "approval_request" | "task_completed" | "agent_error" | "daily_summary";
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  readAt?: string | null;
  metadata?: NotificationMetadata;
  createdAt: string;
};

export type UserSettings = {
  id: number;
  developerModeDefault: boolean;
  aiTaskAnalysisDefault: boolean;
  claudeApiKeyConfigured?: boolean;
  claudeApiKeyMasked?: string | null;
  createdAt: string;
  updatedAt: string;
};

// ==================== AI駆動開発モード関連 ====================

// AI エージェント設定
export type AIAgentConfig = {
  id: number;
  agentType: string; // claude-code, codex, gemini, custom
  name: string;
  endpoint?: string | null;
  modelId?: string | null;
  isDefault: boolean;
  isActive: boolean;
  capabilities: AgentCapability;
  createdAt: string;
  updatedAt: string;
  _count?: { executions: number };
};

export type AgentCapability = {
  codeGeneration: boolean;
  codeReview: boolean;
  taskAnalysis: boolean;
  fileOperations: boolean;
  terminalAccess: boolean;
  gitOperations?: boolean;
  webSearch?: boolean;
};

export type AgentType = "claude-code" | "codex" | "gemini" | "custom";

// エージェント実行
export type AgentExecution = {
  id: number;
  sessionId: number;
  agentConfigId?: number | null;
  agentConfig?: AIAgentConfig;
  command: string;
  status: AgentExecutionStatus;
  output?: string | null;
  artifacts?: AgentArtifact[] | null;
  startedAt?: string | null;
  completedAt?: string | null;
  tokensUsed: number;
  executionTimeMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  gitCommits?: GitCommit[];
};

export type AgentExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentArtifact = {
  type: "file" | "code" | "diff" | "log";
  name: string;
  content: string;
  path?: string;
};

// Git コミット追跡
export type GitCommit = {
  id: number;
  executionId: number;
  commitHash: string;
  message: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: string;
};

// ==================== GitHub連携関連 ====================

export type GitHubIntegration = {
  id: number;
  repositoryUrl: string;
  repositoryName: string;
  ownerName: string;
  isActive: boolean;
  syncIssues: boolean;
  syncPullRequests: boolean;
  autoLinkTasks: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    pullRequests: number;
    issues: number;
  };
};

export type GitHubPullRequest = {
  id: number;
  integrationId: number;
  integration?: GitHubIntegration;
  prNumber: number;
  title: string;
  body?: string | null;
  state: "open" | "closed" | "merged";
  headBranch: string;
  baseBranch: string;
  authorLogin: string;
  url: string;
  linkedTaskId?: number | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
  reviews?: GitHubPRReview[];
  comments?: GitHubPRComment[];
  _count?: {
    reviews: number;
    comments: number;
  };
};

export type GitHubPRReview = {
  id: number;
  pullRequestId: number;
  reviewId: number;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING";
  body?: string | null;
  authorLogin: string;
  submittedAt: string;
  createdAt: string;
};

export type GitHubPRComment = {
  id: number;
  pullRequestId: number;
  commentId: number;
  body: string;
  path?: string | null;
  line?: number | null;
  authorLogin: string;
  isFromRapitas: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GitHubIssue = {
  id: number;
  integrationId: number;
  integration?: GitHubIntegration;
  issueNumber: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels: string[];
  authorLogin: string;
  url: string;
  linkedTaskId?: number | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type FileDiff = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

// ==================== リアルタイム通信関連 ====================

export type SSEEvent = {
  type: string;
  data: unknown;
  id?: string;
  timestamp: string;
};

export type ExecutionOutputEvent = {
  executionId: number;
  output: string;
  isError: boolean;
  timestamp: string;
};

export type ExecutionStatusEvent = {
  executionId: number;
  status: AgentExecutionStatus;
  timestamp: string;
};

export type GitHubEventData = {
  action: string;
  prNumber?: number;
  issueNumber?: number;
  title?: string;
  repo: string;
  timestamp: string;
};

// ==================== 拡張された通知タイプ ====================

export type NotificationType =
  | "approval_request"
  | "task_completed"
  | "agent_error"
  | "daily_summary"
  | "pr_review_requested"
  | "pr_approved"
  | "pr_changes_requested"
  | "agent_execution_started"
  | "agent_execution_complete"
  | "github_sync_complete";

// ==================== 拡張されたTask型 ====================

export type TaskWithGitHub = Task & {
  githubIssueId?: number | null;
  githubPrId?: number | null;
  autoExecutable?: boolean;
  requireApproval?: "always" | "major_only" | "never";
  githubIssue?: GitHubIssue;
  githubPr?: GitHubPullRequest;
};

// ==================== 拡張された承認リクエスト型 ====================

export type ApprovalRequestExtended = ApprovalRequest & {
  executionType?: "code_execution" | "pr_merge" | "deployment" | null;
  estimatedChanges?: {
    files?: string[];
    additions?: number;
    deletions?: number;
  } | null;
};

// ==================== 拡張されたDeveloperModeConfig型 ====================

export type DeveloperModeConfigExtended = DeveloperModeConfig & {
  requireApproval?: "always" | "major_only" | "never";
  autoExecuteOn?: string[];
};

// ==================== コードレビュー関連 ====================

export type ReviewComment = {
  id: string;
  file?: string;
  line?: number;
  content: string;
  type: "comment" | "change_request" | "question";
};
