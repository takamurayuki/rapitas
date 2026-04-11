/**
 * Routes barrel export
 * Import all route modules here for centralized management
 */

// Organization
export { categoriesRoutes } from './organization/categories';
export { themesRoutes } from './organization/themes';
export { labelsRoutes, taskLabelsRoutes } from './organization/labels';
export { projectsRoutes } from './organization/projects';
export { milestonesRoutes } from './organization/milestones';
export { templatesRoutes } from './organization/templates';

// Tasks
export { tasksRoutes } from './tasks/tasks';
export { taskStatisticsRoutes } from './tasks/task-statistics';
export { tempStatisticsRoutes } from './tasks/temp-statistics';
export { taskDependencyRoutes } from './tasks/task-dependency';
export { taskDependencyGraphRoutes } from './tasks/task-dependency-graph';
export { taskAnalysisConfigRoutes } from './tasks/task-analysis-config';
export { batchRoutes } from './tasks/batch';
export { recurringTaskRoutes } from './tasks/recurring-tasks';
export { taskSuggestionRoutes } from './tasks/task-suggestions';
export { taskQuickCreateRoutes } from './tasks/task-quick-create';
export { taskAutoGenerateRoutes } from './tasks/task-auto-generate';

// Agents
export { approvalsRoutes } from './agents/integrations/approvals';
export { orchestrator } from '../services/core/orchestrator-instance';
export { aiAgentRoutes } from './agents/integrations/ai-agent';
export { parallelExecutionRoutes } from './agents/integrations/parallel-execution';
export { agentExecutionConfigRoutes } from './agents/config/agent-execution-config';
export { executionLogsRoutes } from './agents/monitoring/execution-logs';
export { agentMetricsRouter } from './agents/monitoring/agent-metrics';
export { agentVersionManagementRoutes } from './agents/system/agent-version-management';
export { cliToolsManagementRoutes } from './agents/integrations/cli-tools-management';
export { executionForkRoutes } from './agents/execution-management/execution-fork-routes';
export { smartRouterRoutes } from './agents/system/smart-router-routes';

// AI
export { aiChatRoutes } from './ai/ai-chat';
export { promptsRoutes } from './ai/prompts';
export { systemPromptsRoutes } from './ai/system-prompts';

// Scheduling
export { schedulesRoutes } from './scheduling/schedules';
export { dailyScheduleRoutes } from './scheduling/daily-schedule';
export { pomodoroRoutes } from './scheduling/pomodoro';
export { timeEntriesRoutes } from './scheduling/time-entries';

// Learning
export { examGoalsRoutes } from './learning/exam-goals';
export { studyStreaksRoutes } from './learning/study-streaks';
export { learningGoalsRoutes } from './learning/learning-goals';
export { flashcardsRoutes } from './learning/flashcards';
export { resourcesRoutes } from './learning/resources';
export { learningDashboardRouter } from './learning/learning-dashboard';

// System
export { settingsRoutes } from './system/settings';
export { authRoutes } from './system/auth';
export { sseRoutes } from './system/sse';
export { developerModeRoutes } from './system/developer-mode';
export { notificationsRoutes } from './system/notifications';
export { searchRoutes } from './system/search';
export { urlMetadataRoutes } from './system/url-metadata';
export { screenshotsRoutes } from './system/screenshots';
export { directoriesRoutes } from './system/directories';
export { smartActionRoutes } from './system/smart-action';
export { localLLMRouter } from './system/local-llm';
export { transcribeRouter } from './system/transcribe';
export { mcpRoutes } from './system/mcp';
export { gitCleanupRoutes } from './system/git-cleanup';
// System > Monitoring (extracted per FOLDER_ORGANIZATION_POLICY)
export { rateLimitRoutes } from './system/monitoring/rate-limits';
export { progressSummaryRoutes } from './system/monitoring/progress-summary';
export { techDebtRoutes } from './system/monitoring/tech-debt';
export { temporalDebugRoutes } from './system/monitoring/temporal-debug';
export { projectHealthRoutes } from './system/monitoring/project-health';

// Workflow
export { workflowRoutes } from './workflow/core/workflow';
export { workflowRolesRoutes } from './workflow/core/workflow-roles';
export { orchestraRoutes } from './workflow/orchestra';
export { workflowLearningRoutes } from './workflow/workflow-learning';
export { intentRoutes } from './workflow/intent-routes';

// Social
export { commentsRoutes } from './social/comments';
export { githubRoutes, taskGithubRoutes } from './social/github';

// Analytics
export { statisticsRoutes } from './analytics/statistics';
export { reportsRoutes } from './analytics/reports';
export { intelligentSuggestionsRoutes } from './analytics/intelligent-suggestions';
export { weeklyReviewRoutes } from './analytics/weekly-review';

// Lifestyle
export { habitsRoutes } from './lifestyle/habits';
export { paidLeaveRoutes } from './lifestyle/paid-leave';

// Memory
export { knowledgeRoutes } from './memory/knowledge';
export { memorySystemRoutes } from './memory/memory-system';
export { crossProjectKnowledgeRoutes } from './memory/cross-project-knowledge';

// Self-Learning
export { experimentsRoutes } from './self-learning/experiments';
export { knowledgeGraphRoutes } from './self-learning/knowledge-graph';
export { learningRoutes } from './self-learning/learning';
