/**
 * types/index
 *
 * Barrel re-export for all domain-specific type modules.
 * Maintains backward compatibility: all existing imports from 'types' continue to work.
 */

export type {
  Priority,
  Status,
} from './common.types';

export type {
  CategoryMode,
  Category,
  Theme,
  Project,
  Milestone,
} from './project.types';

export type {
  WorkflowStatus,
  WorkflowMode,
  WorkflowFileType,
  WorkflowFile,
  WorkflowPathInfo,
  WorkflowRole,
  WorkflowRoleConfig,
} from './workflow.types';

export type {
  Label,
  TaskLabel,
  ExamGoal,
  StudyStreak,
  LearningGoalSubtask,
  LearningGoalTask,
  LearningGoalPhase,
  LearningGoalResource,
  GeneratedLearningPlan,
  LearningGoal,
  Habit,
  HabitLog,
  Resource,
  FlashcardDeck,
  Flashcard,
} from './learning.types';

export type {
  TimeEntry,
  LinkedCommentSummary,
  CommentLink,
  Comment,
  CommentSearchResult,
  Task,
  TaskTemplateData,
  TaskTemplate,
  WeeklyReport,
} from './task.types';

export {
  priorityColors,
  priorityLabels,
} from './task.types';

export type {
  ExecutionStatus,
  AgentStatus,
  ExecutionResult,
  DeveloperModeConfig,
  AgentSessionMetadata,
  AgentSession,
  AgentActionInput,
  AgentActionOutput,
  AgentAction,
  SubtaskProposal,
  TaskAnalysisResult,
  ApprovalRequest,
  NotificationMetadata,
  Notification,
  AgentCapability,
  AgentType,
  AIAgentConfig,
  AgentExecutionStatus,
  AgentArtifact,
  AgentExecution,
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  TaskAnalysisConfig,
  BranchStrategy,
  ApprovalMode,
  ReviewScope,
  AgentExecutionConfig,
} from './agent.types';

export type {
  GitCommit,
  GitHubIntegration,
  GitHubPullRequest,
  GitHubPRReview,
  GitHubPRComment,
  GitHubIssue,
  FileDiff,
  ScreenshotInfo,
  ReviewComment,
} from './github.types';

export type {
  SSEEvent,
  ExecutionOutputEvent,
  ExecutionStatusEvent,
  GitHubEventData,
} from './realtime.types';

export type {
  AIChatMessage,
  AIChatState,
  AIChatAction,
  AIServiceResponse,
} from './ai-chat.types';

export type {
  ApiProvider,
  ApiKeyStatus,
  ActiveMode,
  UserSettings,
} from './settings.types';

export type {
  ScheduleEventType,
  ScheduleEvent,
  ScheduleEventInput,
  PaidLeaveBalance,
  DailyScheduleBlock,
} from './schedule.types';
