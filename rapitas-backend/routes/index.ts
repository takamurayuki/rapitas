/**
 * Routes barrel export
 * Import all route modules here for centralized management
 */
export { categoriesRoutes } from "./categories";
export { themesRoutes } from "./themes";
export { labelsRoutes, taskLabelsRoutes } from "./labels";
export { projectsRoutes } from "./projects";
export { milestonesRoutes } from "./milestones";
export { timeEntriesRoutes } from "./time-entries";
export { commentsRoutes } from "./comments";
export { notificationsRoutes } from "./notifications";
export { settingsRoutes } from "./settings";
export { tasksRoutes } from "./tasks";
export { examGoalsRoutes } from "./exam-goals";
export { studyStreaksRoutes } from "./study-streaks";
export { resourcesRoutes } from "./resources";
export { directoriesRoutes } from "./directories";
export { statisticsRoutes } from "./statistics";
export { achievementsRoutes } from "./achievements";
export { habitsRoutes } from "./habits";
export { flashcardsRoutes } from "./flashcards";
export { templatesRoutes } from "./templates";
export { reportsRoutes } from "./reports";
export { promptsRoutes } from "./prompts";
export { systemPromptsRoutes } from "./system-prompts";
export { developerModeRoutes } from "./developer-mode";
export { aiChatRoutes } from "./ai-chat";

// New modular routes
export { sseRoutes } from "./sse";
export { taskDependencyRoutes } from "./task-dependency";
export { githubRoutes, taskGithubRoutes } from "./github";
export { approvalsRoutes, orchestrator } from "./approvals";
export { aiAgentRoutes } from "./ai-agent";
export { parallelExecutionRoutes } from "./parallel-execution";
export { taskAnalysisConfigRoutes } from "./task-analysis-config";
export { agentExecutionConfigRoutes } from "./agent-execution-config";
export { executionLogsRoutes } from "./execution-logs";
export { schedulesRoutes } from "./schedules";
export { dailyScheduleRoutes } from "./daily-schedule";
export { screenshotsRoutes } from "./screenshots";
export { learningGoalsRoutes } from "./learning-goals";
