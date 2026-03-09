/**
 * Routes barrel export
 * Import all route modules here for centralized management
 */

// Organization - 分類・構造管理
export { categoriesRoutes } from "./organization/categories";
export { themesRoutes } from "./organization/themes";
export { labelsRoutes, taskLabelsRoutes } from "./organization/labels";
export { projectsRoutes } from "./organization/projects";
export { milestonesRoutes } from "./organization/milestones";
export { templatesRoutes } from "./organization/templates";

// Tasks - タスク管理
export { tasksRoutes } from "./tasks/tasks";
export { taskDependencyRoutes } from "./tasks/task-dependency";
export { taskAnalysisConfigRoutes } from "./tasks/task-analysis-config";
export { batchRoutes } from "./tasks/batch";

// Agents - エージェント関連
export { approvalsRoutes } from "./agents/approvals";
export { orchestrator } from "../services/orchestrator-instance";
export { aiAgentRoutes } from "./agents/ai-agent";
export { parallelExecutionRoutes } from "./agents/parallel-execution";
export { agentExecutionConfigRoutes } from "./agents/agent-execution-config";
export { executionLogsRoutes } from "./agents/execution-logs";
export { agentMetricsRouter } from "./agents/agent-metrics";
export { agentVersionManagementRoutes } from "./agents/agent-version-management";
export { cliToolsManagementRoutes } from "./agents/cli-tools-management";

// AI - AI機能
export { aiChatRoutes } from "./ai/ai-chat";
export { promptsRoutes } from "./ai/prompts";
export { systemPromptsRoutes } from "./ai/system-prompts";

// Scheduling - 時間・スケジュール管理
export { schedulesRoutes } from "./scheduling/schedules";
export { dailyScheduleRoutes } from "./scheduling/daily-schedule";
export { pomodoroRoutes } from "./scheduling/pomodoro";
export { timeEntriesRoutes } from "./scheduling/time-entries";

// Learning - 学習関連
export { examGoalsRoutes } from "./learning/exam-goals";
export { studyStreaksRoutes } from "./learning/study-streaks";
export { learningGoalsRoutes } from "./learning/learning-goals";
export { flashcardsRoutes } from "./learning/flashcards";
export { resourcesRoutes } from "./learning/resources";

// System - システム基盤
export { settingsRoutes } from "./system/settings";
export { authRoutes } from "./system/auth";
export { sseRoutes } from "./system/sse";
export { developerModeRoutes } from "./system/developer-mode";
export { notificationsRoutes } from "./system/notifications";
export { searchRoutes } from "./system/search";
export { urlMetadataRoutes } from "./system/url-metadata";
export { screenshotsRoutes } from "./system/screenshots";
export { rateLimitRoutes } from "./system/rate-limits";
export { directoriesRoutes } from "./system/directories";
export { smartActionRoutes } from "./system/smart-action";

// Workflow - ワークフロー関連
export { workflowRoutes } from "./workflow/workflow";
export { workflowRolesRoutes } from "./workflow/workflow-roles";
export { orchestraRoutes } from "./workflow/orchestra";

// Social - コミュニケーション・外部連携
export { commentsRoutes } from "./social/comments";
export { githubRoutes, taskGithubRoutes } from "./social/github";

// Analytics - 分析・レポート
export { statisticsRoutes } from "./analytics/statistics";
export { reportsRoutes } from "./analytics/reports";

// Lifestyle - 生活管理
export { habitsRoutes } from "./lifestyle/habits";
export { paidLeaveRoutes } from "./lifestyle/paid-leave";

// Memory - メモリ/知識管理
export { knowledgeRoutes } from "./memory/knowledge";
export { memorySystemRoutes } from "./memory/memory-system";
