// Tauri/SQLite initialization - must be imported first
import { initializeDatabase, isTauriBuild } from "./utils/tauri-init";

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
  developerModeRoutes,
  aiChatRoutes,
  sseRoutes,
  taskDependencyRoutes,
  githubRoutes,
  taskGithubRoutes,
  approvalsRoutes,
  aiAgentRoutes,
} from "./routes";

// Import shared database client
import { prisma } from "./config";

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
app.use(developerModeRoutes);
app.use(aiChatRoutes);
app.use(sseRoutes);
app.use(taskDependencyRoutes);
app.use(githubRoutes);
app.use(taskGithubRoutes);
app.use(approvalsRoutes);
app.use(aiAgentRoutes);

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database for Tauri/SQLite builds
    if (isTauriBuild) {
      console.log("🔧 Initializing SQLite database for Tauri...");
      await initializeDatabase(prisma);
    }

    app.listen(3001);
    console.log("🚀 Rapitas backend running on http://localhost:3001");
    if (isTauriBuild) {
      console.log("📦 Running in Tauri mode with SQLite database");
    }
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
