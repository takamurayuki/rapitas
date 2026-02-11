export type CategoryMode = "development" | "learning" | "both";

export type Category = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  mode: CategoryMode;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  themes?: Theme[];
  _count?: {
    themes: number;
  };
};

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
  sortOrder: number;
  categoryId?: number | null;
  category?: Category | null;
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
  sortOrder: number;
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

// 学習目標
export type LearningGoalSubtask = {
  title: string;
  description?: string;
  estimatedHours?: number;
};

export type LearningGoalTask = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority?: string;
  subtasks?: LearningGoalSubtask[];
};

export type LearningGoalPhase = {
  name: string;
  days: number;
  description?: string;
  tasks: LearningGoalTask[];
};

export type LearningGoalResource = {
  title: string;
  type: string;
  description: string;
  url?: string;
};

export type GeneratedLearningPlan = {
  themeName?: string;
  themeDescription?: string;
  phases: LearningGoalPhase[];
  recommendedResources?: LearningGoalResource[];
  tips?: string[];
};

export type LearningGoal = {
  id: number;
  title: string;
  description?: string | null;
  currentLevel?: string | null;
  targetLevel?: string | null;
  deadline?: string | null;
  dailyHours: number;
  categoryId?: number | null;
  themeId?: number | null;
  status: "active" | "completed" | "archived";
  generatedPlan?: string | null;
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
  taskAnalysisConfig?: TaskAnalysisConfig | null;
  agentExecutionConfig?: AgentExecutionConfig | null;
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

// Linked comment summary (used in link relations)
export type LinkedCommentSummary = {
  id: number;
  content: string;
  taskId: number;
  createdAt: string;
};

// Comment link relation
export type CommentLink = {
  id: number;
  fromCommentId: number;
  toCommentId: number;
  label?: string | null;
  fromComment?: LinkedCommentSummary;
  toComment?: LinkedCommentSummary;
  createdAt: string;
};

// Combined link for UI display
export type CommentLinkDisplay = {
  id: number;
  direction: "outgoing" | "incoming";
  label?: string | null;
  linkedComment: LinkedCommentSummary;
  createdAt: string;
};

export type Comment = {
  id: number;
  taskId: number;
  content: string;
  parentId?: number | null;
  replies?: Comment[];
  // Link relations
  linksFrom?: CommentLink[];
  linksTo?: CommentLink[];
  createdAt: string;
  updatedAt: string;
};

// Search result for comment linking
export type CommentSearchResult = {
  id: number;
  content: string;
  taskId: number;
  createdAt: string;
  task?: {
    id: number;
    title: string;
  };
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
  // File upload fields
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
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
  themeId?: number | null;
  theme?: {
    id: number;
    name: string;
    color: string;
    icon?: string | null;
  } | null;
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

// 実行ステータス（共通）
export type ExecutionStatus = "idle" | "running" | "completed" | "failed";

// 実行結果（共通）
export type ExecutionResult = {
  success: boolean;
  sessionId?: number;
  executionId?: number;
  approvalRequestId?: number;
  message?: string;
  error?: string;
  // 復元された実行の追加情報
  output?: string;
  waitingForInput?: boolean;
  question?: string;
};

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
  requestType:
    | "subtask_creation"
    | "task_execution"
    | "task_completion"
    | "code_review";
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
    // スクリーンショット
    screenshots?: ScreenshotInfo[];
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
  type:
    | "approval_request"
    | "task_completed"
    | "agent_error"
    | "daily_summary"
    | "pr_review_requested"
    | "agent_execution_started";
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  readAt?: string | null;
  metadata?: NotificationMetadata;
  createdAt: string;
};

export type ApiProvider = "claude" | "chatgpt" | "gemini";

export type ApiKeyStatus = {
  configured: boolean;
  maskedKey: string | null;
};

export type ActiveMode = "development" | "learning" | "both";

export type UserSettings = {
  id: number;
  aiTaskAnalysisDefault: boolean;
  autoResumeInterruptedTasks: boolean;
  autoExecuteAfterCreate: boolean;
  autoGenerateTitle: boolean;
  defaultCategoryId?: number | null;
  activeMode: ActiveMode;
  claudeApiKeyConfigured?: boolean;
  claudeApiKeyMasked?: string | null;
  chatgptApiKeyConfigured?: boolean;
  chatgptApiKeyMasked?: string | null;
  geminiApiKeyConfigured?: boolean;
  geminiApiKeyMasked?: string | null;
  claudeDefaultModel?: string | null;
  chatgptDefaultModel?: string | null;
  geminiDefaultModel?: string | null;
  defaultAiProvider?: ApiProvider | null;
  createdAt: string;
  updatedAt: string;
};

// ==================== AI駆動開発モード関連 ====================

// AI エージェント設定
export type AIAgentConfig = {
  id: number;
  agentType: string; // claude-code, anthropic-api, openai, azure-openai, gemini, custom
  name: string;
  endpoint?: string | null;
  modelId?: string | null;
  isDefault: boolean;
  isActive: boolean;
  capabilities: AgentCapability;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
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

export type AgentType =
  | "claude-code"
  | "codex"
  | "gemini"
  | "custom"
  | "openai"
  | "azure-openai";

// エージェント設定フィールドのスキーマ
export type ConfigFieldSchema = {
  name: string;
  label: string;
  type: "text" | "password" | "url" | "select" | "number" | "boolean";
  description?: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
};

// エージェント設定スキーマ
export type AgentConfigSchema = {
  agentType: string;
  displayName: string;
  description: string;
  apiKeyRequired: boolean;
  apiKeyLabel?: string;
  apiKeyPrefix?: string;
  apiKeyPlaceholder?: string;
  endpointRequired: boolean;
  defaultEndpoint?: string;
  modelRequired: boolean;
  availableModels?: Array<{ value: string; label: string }>;
  defaultModel?: string;
  additionalFields?: ConfigFieldSchema[];
  capabilities: AgentCapability;
};

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

export type ScreenshotInfo = {
  id: string;
  filename: string;
  url: string;
  page: string;
  label: string;
  capturedAt: string;
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

// ==================== Floating AI Menu ====================

export type AIChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

export type AIChatState = {
  messages: AIChatMessage[];
  isLoading: boolean;
  error: string | null;
  isExpanded: boolean;
};

export type AIChatAction =
  | { type: "ADD_MESSAGE"; payload: AIChatMessage }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_EXPANDED"; payload: boolean }
  | { type: "CLEAR_MESSAGES" };

export type AIServiceConfig = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
};

export type AIServiceResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

// ==================== タスク分析設定 ====================

export type AnalysisDepth = "quick" | "standard" | "deep";
export type PriorityStrategy = "aggressive" | "balanced" | "conservative";
export type PromptStrategy = "auto" | "detailed" | "concise" | "custom";

export type TaskAnalysisConfig = {
  id: number;
  taskId: number;

  // 分析パラメータ
  analysisDepth: AnalysisDepth;
  maxSubtasks: number;
  priorityStrategy: PriorityStrategy;
  includeEstimates: boolean;
  includeDependencies: boolean;
  includeTips: boolean;

  // モデル・プロバイダ設定
  agentConfigId?: number | null;
  agentConfig?: Pick<
    AIAgentConfig,
    "id" | "agentType" | "name" | "modelId" | "isActive"
  > | null;
  modelOverride?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;

  // プロンプト戦略
  promptStrategy: PromptStrategy;
  customPromptTemplate?: string | null;
  contextInstructions?: string | null;

  // 自動化設定
  autoApproveSubtasks: boolean;
  autoOptimizePrompt: boolean;
  notifyOnComplete: boolean;

  createdAt: string;
  updatedAt: string;
};

export type TaskAnalysisConfigInput = Partial<
  Omit<
    TaskAnalysisConfig,
    "id" | "taskId" | "agentConfig" | "createdAt" | "updatedAt"
  >
>;

// ==================== エージェント実行設定 ====================

export type BranchStrategy = "auto" | "manual" | "none";
export type ApprovalMode = "always" | "major_only" | "never";
export type ReviewScope = "changes" | "full" | "none";

export type AgentExecutionConfig = {
  id: number;
  taskId: number;

  // エージェント選択
  agentConfigId?: number | null;
  agentConfig?: Pick<
    AIAgentConfig,
    "id" | "agentType" | "name" | "modelId" | "isActive"
  > | null;

  // 実行環境設定
  workingDirectory?: string | null;
  timeoutMs: number;
  maxRetries: number;

  // Git設定
  branchStrategy: BranchStrategy;
  branchPrefix: string;
  autoCommit: boolean;
  autoCreatePR: boolean;

  // 実行制御
  requireApproval: ApprovalMode;
  autoExecuteOnAnalysis: boolean;
  parallelExecution: boolean;
  maxConcurrentAgents: number;

  // プロンプト設定
  useOptimizedPrompt: boolean;
  additionalInstructions?: string | null;

  // コードレビュー設定
  autoCodeReview: boolean;
  reviewScope: ReviewScope;

  // 通知設定
  notifyOnStart: boolean;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  notifyOnQuestion: boolean;

  createdAt: string;
  updatedAt: string;
};

export type AgentExecutionConfigInput = Partial<
  Omit<
    AgentExecutionConfig,
    "id" | "taskId" | "agentConfig" | "createdAt" | "updatedAt"
  >
>;

// ==================== スケジュールイベント ====================

export type ScheduleEvent = {
  id: number;
  title: string;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  isAllDay: boolean;
  color: string;
  reminderMinutes?: number | null;
  reminderSentAt?: string | null;
  taskId?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleEventInput = {
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  isAllDay?: boolean;
  color?: string;
  reminderMinutes?: number | null;
  taskId?: number | null;
};

export type DailyScheduleBlock = {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  color: string;
  icon?: string | null;
  category: string;
  isNotify: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
