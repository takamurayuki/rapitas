// Setup global error handlers
import { setupGlobalErrorHandlers, errorHandler } from "./middleware";
setupGlobalErrorHandlers();

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

// Import modular routes
import {
  themesRoutes,
  labelsRoutes,
  taskLabelsRoutes,
  projectsRoutes,
  milestonesRoutes,
  timeEntriesRoutes,
  commentsRoutes,
  notificationsRoutes,
  settingsRoutes,
  tasksRoutes,
  examGoalsRoutes,
  studyStreaksRoutes,
  resourcesRoutes,
  directoriesRoutes,
  studyPlansRoutes,
  statisticsRoutes,
  achievementsRoutes,
  habitsRoutes,
  flashcardsRoutes,
  templatesRoutes,
  reportsRoutes,
  promptsRoutes,
  systemPromptsRoutes,
  developerModeRoutes,
  aiChatRoutes,
  sseRoutes,
  taskDependencyRoutes,
  githubRoutes,
  taskGithubRoutes,
  approvalsRoutes,
  aiAgentRoutes,
  parallelExecutionRoutes,
  taskAnalysisConfigRoutes,
  agentExecutionConfigRoutes,
  executionLogsRoutes,
  schedulesRoutes,
} from "./routes";

// Import shared database client
import { prisma, ensureDatabaseConnection } from "./config";

// Import orchestrator for startup recovery
import { orchestrator } from "./routes/approvals";

// Ensure database connection before starting server
await ensureDatabaseConnection();

const app = new Elysia();

// Apply middleware
app.use(cors());
app.use(errorHandler);

// Swagger documentation
app.use(
  swagger({
    documentation: {
      info: {
        title: "Rapitas API",
        version: "1.0.0",
        description:
          "Rapitas - AI-powered task management and development automation API",
      },
      tags: [
        { name: "Tasks", description: "Task management operations" },
        { name: "Projects", description: "Project management operations" },
        { name: "Themes", description: "Theme/workspace operations" },
        { name: "Labels", description: "Label management operations" },
        { name: "Milestones", description: "Milestone management operations" },
        { name: "Time Entries", description: "Time tracking operations" },
        { name: "Comments", description: "Comment operations" },
        { name: "Notifications", description: "Notification operations" },
        { name: "Settings", description: "User settings operations" },
        { name: "GitHub", description: "GitHub integration operations" },
        { name: "Approvals", description: "Approval workflow operations" },
        {
          name: "AI Agents",
          description: "AI agent execution and configuration",
        },
        {
          name: "SSE",
          description: "Server-Sent Events for real-time updates",
        },
        {
          name: "Study",
          description: "Study-related features (exam goals, streaks, plans)",
        },
        { name: "Resources", description: "Resource management" },
        { name: "AI Chat", description: "AI chat functionality" },
        { name: "Developer Mode", description: "Developer mode configuration" },
      ],
    },
    path: "/api/docs",
    exclude: ["/api/docs", "/api/docs/json"],
  }),
);

// Apply modular routes
app.use(themesRoutes);
app.use(labelsRoutes);
app.use(taskLabelsRoutes);
app.use(projectsRoutes);
app.use(milestonesRoutes);
app.use(timeEntriesRoutes);
app.use(commentsRoutes);
app.use(notificationsRoutes);
app.use(settingsRoutes);
app.use(tasksRoutes);
app.use(examGoalsRoutes);
app.use(studyStreaksRoutes);
app.use(resourcesRoutes);
app.use(directoriesRoutes);
app.use(studyPlansRoutes);
app.use(statisticsRoutes);
app.use(achievementsRoutes);
app.use(habitsRoutes);
app.use(flashcardsRoutes);
app.use(templatesRoutes);
app.use(reportsRoutes);
app.use(promptsRoutes);
app.use(systemPromptsRoutes);
app.use(developerModeRoutes);
app.use(aiChatRoutes);
app.use(sseRoutes);
app.use(taskDependencyRoutes);
app.use(githubRoutes);
app.use(taskGithubRoutes);
app.use(approvalsRoutes);
app.use(aiAgentRoutes);
app.use(parallelExecutionRoutes);
app.use(taskAnalysisConfigRoutes);
app.use(agentExecutionConfigRoutes);
app.use(executionLogsRoutes);
app.use(schedulesRoutes);

// Start server
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen({
  port: PORT,
  idleTimeout: 30, // 30秒のアイドルタイムアウトでCLOSE_WAIT蓄積を防止
});
console.log(`🚀 Rapitas backend running on http://localhost:${PORT}`);

// Startup recovery: mark stale running/pending executions as interrupted
// and update related Task/Session statuses, then auto-resume if enabled
orchestrator.recoverStaleExecutions().then(async (result) => {
  if (result.recoveredExecutions > 0) {
    console.log(
      `🔄 Startup recovery: ${result.recoveredExecutions} executions, ${result.updatedTasks} tasks, ${result.updatedSessions} sessions recovered`
    );
  }

  // Check auto-resume setting and resume interrupted executions
  if (result.interruptedExecutionIds.length > 0) {
    try {
      const settings = await prisma.userSettings.findFirst();
      if (settings?.autoResumeInterruptedTasks) {
        console.log(`🔄 Auto-resume enabled. Resuming ${result.interruptedExecutionIds.length} interrupted executions...`);

        for (const executionId of result.interruptedExecutionIds) {
          try {
            const res = await fetch(`http://localhost:${PORT}/agents/executions/${executionId}/resume`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });
            const data = await res.json() as { success: boolean; taskTitle?: string; message?: string; error?: string };
            if (data.success) {
              console.log(`✅ Auto-resumed execution ${executionId}: ${data.taskTitle || data.message}`);
            } else {
              console.warn(`⚠️ Failed to auto-resume execution ${executionId}: ${data.error}`);
            }
          } catch (error) {
            console.error(`❌ Error auto-resuming execution ${executionId}:`, error);
          }
        }

        // Create notification about auto-resume
        await prisma.notification.create({
          data: {
            type: "agent_execution_resumed",
            title: "自動再開完了",
            message: `サーバー再起動後、${result.interruptedExecutionIds.length}件の中断されたタスクを自動再開しました。`,
            link: "/",
          },
        }).catch((err: Error) => {
          console.error("❌ Failed to create auto-resume notification:", err);
        });
      }
    } catch (error) {
      console.error("❌ Auto-resume check failed:", error);
    }
  }
}).catch((error) => {
  console.error("❌ Startup recovery failed:", error);
});
