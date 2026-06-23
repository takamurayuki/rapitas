// register-routes.ts — Mounts all modular routes onto the Elysia app.
// Extracted from index.ts to keep the entry point under 300 lines.
import type { Elysia } from 'elysia';
import {
  categoriesRoutes,
  themesRoutes,
  labelsRoutes,
  taskLabelsRoutes,
  projectsRoutes,
  milestonesRoutes,
  templatesRoutes,
  tasksRoutes,
  ganttDataRoute,
  taskSuggestionRoutes,
  taskQuickCreateRoutes,
  taskAutoGenerateRoutes,
  tempStatisticsRoutes,
  taskAnalysisConfigRoutes,
  batchRoutes,
  recurringTaskRoutes,
  approvalsRoutes,
  aiAgentRoutes,
  agentExecutionConfigRoutes,
  agentAvailabilityRoutes,
  providerCooldownsRoutes,
  executionLogsRoutes,
  agentMetricsRouter,
  agentVersionManagementRoutes,
  cliToolsManagementRoutes,
  executionForkRoutes,
  smartRouterRoutes,
  timeEntriesRoutes,
  pomodoroRoutes,
  commentsRoutes,
  githubRoutes,
  taskGithubRoutes,
  statisticsRoutes,
  reportsRoutes,
  intelligentSuggestionsRoutes,
  weeklyReviewRoutes,
  habitsRoutes,
  paidLeaveRoutes,
  knowledgeRoutes,
  memorySystemRoutes,
  knowledgeGraphRoutes,
  crossProjectKnowledgeRoutes,
  workflowRoutes,
  workflowRolesRoutes,
  workflowLearningRoutes,
  orchestraRoutes,
  themeAutoRunRoutes,
  settingsRoutes,
  authRoutes,
  sseRoutes,
  developerModeRoutes,
  notificationsRoutes,
  searchRoutes,
  urlMetadataRoutes,
  smartActionRoutes,
  localLLMRouter,
  transcribeRouter,
  mcpRoutes,
  rateLimitRoutes,
  progressSummaryRoutes,
  techDebtRoutes,
  temporalDebugRoutes,
  projectHealthRoutes,
  debugLogsRouter,
  gitCacheMetricsRoutes,
  ciTimingRoutes,
  gitCleanupRoutes,
  backupsRoutes,
  errorsRoutes,
  setupRoutes,
  schedulesRoutes,
  dailyScheduleRoutes,
  examGoalsRoutes,
  studyStreaksRoutes,
  resourcesRoutes,
  learningGoalsRoutes,
  learningDashboardRouter,
  directoriesRoutes,
  experimentsRoutes,
  learningRoutes,
  taskSpecRoutes,
  aiChatRoutes,
  copilotChatRoutes,
  promptsRoutes,
  systemPromptsRoutes,
  ideaBoxRoutes,
  concernBacklogRoutes,
  hypothesisRoutes,
  backlogScheduleRoutes,
  backlogThemeOverrideRoutes,
  exportRoutes,
  importRoutes,
} from './routes';

/**
 * Register all modular routes on the Elysia application instance.
 */
export function registerAllRoutes(app: Elysia): void {
  // Organization
  app.use(categoriesRoutes);
  app.use(themesRoutes);
  app.use(labelsRoutes);
  app.use(projectsRoutes);
  app.use(milestonesRoutes);

  // Tasks
  app.use(tasksRoutes);
  app.use(ganttDataRoute);
  app.use(taskSuggestionRoutes);
  app.use(taskQuickCreateRoutes);
  app.use(taskAutoGenerateRoutes);
  app.use(tempStatisticsRoutes);
  app.use(taskAnalysisConfigRoutes);
  app.use(batchRoutes);
  app.use(recurringTaskRoutes);

  // Agents
  app.use(approvalsRoutes);
  app.use(aiAgentRoutes);
  app.use(agentExecutionConfigRoutes);
  app.use(agentAvailabilityRoutes);
  app.use(providerCooldownsRoutes);
  app.use(executionLogsRoutes);
  app.use(agentMetricsRouter);
  app.use(agentVersionManagementRoutes);
  app.use(cliToolsManagementRoutes);
  app.use(executionForkRoutes);
  app.use(smartRouterRoutes);

  // Time tracking
  app.use(timeEntriesRoutes);
  app.use(pomodoroRoutes);

  // Social
  app.use(commentsRoutes);
  app.use(githubRoutes);
  // NOTE: taskGithubRoutes was imported but never mounted — its
  // /tasks/:id/link-github-pr and /create-github-issue endpoints 404'd.
  app.use(taskGithubRoutes);

  // Analytics
  app.use(statisticsRoutes);
  app.use(reportsRoutes);
  app.use(intelligentSuggestionsRoutes);
  app.use(weeklyReviewRoutes);

  // Lifestyle
  app.use(habitsRoutes);
  app.use(paidLeaveRoutes);

  // Memory
  app.use(knowledgeRoutes);
  app.use(memorySystemRoutes);
  app.use(knowledgeGraphRoutes);
  app.use(crossProjectKnowledgeRoutes);
  app.use(ideaBoxRoutes);
  app.use(concernBacklogRoutes);
  app.use(hypothesisRoutes);
  app.use(backlogScheduleRoutes);
  app.use(backlogThemeOverrideRoutes);

  // Workflow
  app.use(workflowRoutes);
  app.use(workflowRolesRoutes);
  app.use(workflowLearningRoutes);
  app.use(orchestraRoutes);
  app.use(themeAutoRunRoutes);

  // System
  app.use(settingsRoutes);
  app.use(authRoutes);
  app.use(sseRoutes);
  app.use(developerModeRoutes);
  app.use(notificationsRoutes);
  app.use(searchRoutes);
  app.use(urlMetadataRoutes);
  app.use(rateLimitRoutes);
  app.use(progressSummaryRoutes);
  app.use(techDebtRoutes);
  app.use(temporalDebugRoutes);
  app.use(projectHealthRoutes);
  app.use(debugLogsRouter);
  app.use(gitCacheMetricsRoutes);
  app.use(ciTimingRoutes);
  app.use(gitCleanupRoutes);
  app.use(backupsRoutes);
  app.use(errorsRoutes);
  app.use(setupRoutes);
  app.use(smartActionRoutes);
  app.use(localLLMRouter);
  app.use(transcribeRouter);
  app.use(mcpRoutes);
  app.use(directoriesRoutes);
  app.use(taskSpecRoutes);
  app.use(exportRoutes);
  app.use(importRoutes);

  // AI
  app.use(aiChatRoutes);
  app.use(copilotChatRoutes);
  app.use(promptsRoutes);
  app.use(systemPromptsRoutes);

  // Scheduling
  app.use(schedulesRoutes);
  app.use(dailyScheduleRoutes);

  // Learning
  app.use(examGoalsRoutes);
  app.use(studyStreaksRoutes);
  app.use(resourcesRoutes);
  app.use(learningGoalsRoutes);
  app.use(learningDashboardRouter);
  app.use(templatesRoutes);
  app.use(experimentsRoutes);
  app.use(learningRoutes);
}
