// Setup global error handlers
import { setupGlobalErrorHandlers, errorHandler, performanceOptimization } from './middleware';
setupGlobalErrorHandlers();

import { createLogger } from './config/logger';
const log = createLogger('server-optimized');

import { Elysia, type Context } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';

// Import modular routes
import {
  categoriesRoutes,
  themesRoutes,
  labelsRoutes,
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
  statisticsRoutes,
  habitsRoutes,
  flashcardsRoutes,
  templatesRoutes,
  reportsRoutes,
  promptsRoutes,
  systemPromptsRoutes,
  developerModeRoutes,
  aiChatRoutes,
  sseRoutes,
  githubRoutes,
  approvalsRoutes,
  aiAgentRoutes,
  parallelExecutionRoutes,
  taskAnalysisConfigRoutes,
  agentExecutionConfigRoutes,
  executionLogsRoutes,
  schedulesRoutes,
  dailyScheduleRoutes,
  screenshotsRoutes,
  learningGoalsRoutes,
  rateLimitRoutes,
  paidLeaveRoutes,
  urlMetadataRoutes,
  batchRoutes,
} from './routes';

// Import optimized batch routes
import { batchRoutesV2 } from './routes/tasks/batch-v2';

// Import WebSocket routes
import { websocketRoutes, wsManager } from './services/communication/websocket-service';

// Import shared database client
import { prisma, ensureDatabaseConnection } from './config';

// Import Prisma optimizations
import { setupPrismaOptimizations } from './utils/database/prisma-optimization';

// Import cache service
import { cacheService } from './services/core/cache-service';

// Import orchestrator for startup recovery
import { orchestrator } from './services/core/orchestrator-instance';

// Import realtime service for SSE cleanup on shutdown
import { realtimeService } from './services/communication/realtime-service';

// Ensure database connection before starting server
await ensureDatabaseConnection();

// Setup Prisma optimizations
setupPrismaOptimizations(prisma);

const app = new Elysia();

// Apply performance optimization middleware
app.use(performanceOptimization);

// Apply CORS
app.use(cors());

// Apply error handler
app.use(errorHandler);

// Swagger documentation
app.use(
  swagger({
    documentation: {
      info: {
        title: 'Rapitas API',
        version: '2.0.0',
        description:
          'Rapitas - AI-powered task management and development automation API with performance optimizations',
      },
      tags: [
        { name: 'Tasks', description: 'Task management operations' },
        { name: 'Projects', description: 'Project management operations' },
        { name: 'Themes', description: 'Theme/workspace operations' },
        { name: 'Labels', description: 'Label management operations' },
        { name: 'Milestones', description: 'Milestone management operations' },
        { name: 'Time Entries', description: 'Time tracking operations' },
        { name: 'Comments', description: 'Comment operations' },
        { name: 'Notifications', description: 'Notification operations' },
        { name: 'Settings', description: 'User settings operations' },
        { name: 'GitHub', description: 'GitHub integration operations' },
        { name: 'Approvals', description: 'Approval workflow operations' },
        {
          name: 'AI Agents',
          description: 'AI agent execution and configuration',
        },
        {
          name: 'SSE',
          description: 'Server-Sent Events for real-time updates',
        },
        {
          name: 'WebSocket',
          description: 'WebSocket connections for real-time bidirectional communication',
        },
        {
          name: 'Batch',
          description: 'Batch API for optimized multiple requests',
        },
        {
          name: 'Study',
          description: 'Study-related features (exam goals, streaks)',
        },
        { name: 'Resources', description: 'Resource management' },
        { name: 'AI Chat', description: 'AI chat functionality' },
        { name: 'Developer Mode', description: 'Developer mode configuration' },
      ],
    },
    path: '/api/docs',
    exclude: ['/api/docs', '/api/docs/json'],
  }),
);

// Apply modular routes
app.use(categoriesRoutes);
app.use(themesRoutes);
app.use(labelsRoutes);
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
app.use(statisticsRoutes);
app.use(habitsRoutes);
app.use(flashcardsRoutes);
app.use(templatesRoutes);
app.use(reportsRoutes);
app.use(promptsRoutes);
app.use(systemPromptsRoutes);
app.use(developerModeRoutes);
app.use(aiChatRoutes);
app.use(sseRoutes);
app.use(githubRoutes);
app.use(approvalsRoutes);
app.use(aiAgentRoutes);
app.use(parallelExecutionRoutes);
app.use(taskAnalysisConfigRoutes);
app.use(agentExecutionConfigRoutes);
app.use(executionLogsRoutes);
app.use(schedulesRoutes);
app.use(dailyScheduleRoutes);
app.use(screenshotsRoutes);
app.use(learningGoalsRoutes);
app.use(rateLimitRoutes);
app.use(paidLeaveRoutes);
app.use(urlMetadataRoutes);
app.use(batchRoutes);

// Apply optimized batch routes
app.use(batchRoutesV2);

// Apply WebSocket routes
app.use(websocketRoutes);

// Health check endpoint with performance metrics
app.get('/health', (context: Context) => {
  const { set } = context;
  const cacheStats = cacheService.getStats();
  const wsStats = wsManager.getStats();

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    performance: {
      cache: cacheStats,
      websocket: {
        totalClients: wsStats.totalClients,
        totalRooms: wsStats.totalRooms,
      },
    },
  };
});

// Start server
const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen({
  port: PORT,
  idleTimeout: 30, // 30-second idle timeout to prevent CLOSE_WAIT accumulation
  reusePort: true, // allows binding even with TIME_WAIT zombie sockets
});
log.info(`Rapitas backend (optimized) running on http://localhost:${PORT}`);

// Set server stop callback for orchestrator (for proper port release during graceful shutdown)
orchestrator.setServerStopCallback(() => {
  app.stop();
});

// Signal handling from bun --watch (for dev:simple mode)
// Close SSE connections immediately on SIGTERM/SIGINT to prevent CLOSE_WAIT accumulation
let isShuttingDown = false;
const handleProcessSignal = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`Received ${signal}, initiating graceful shutdown...`);

  // Force exit timer (force exit after 8 seconds)
  const forceExitTimer = setTimeout(() => {
    log.error('Graceful shutdown timeout, forcing exit...');
    process.exit(1);
  }, 8000);

  try {
    // Step 1: First close the listening socket (reject new connections)
    log.info('Step 1: Stopping listener (no new connections)...');
    try {
      app.stop();
    } catch (error) {
      log.error({ err: error }, 'Error stopping listener');
    }

    // Step 2: Close all WebSocket and SSE connections
    log.info('Step 2: Closing WebSocket and SSE connections...');
    wsManager.shutdown();
    const clientCount = realtimeService.getClientCount();
    realtimeService.shutdown();
    log.info({ clientCount }, `Closed ${clientCount} SSE client(s).`);

    // Step 3: Wait for connections to drain
    log.info('Step 3: Waiting for connections to drain...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 4: Save cache statistics
    log.info('Step 4: Saving cache statistics...');
    const cacheStats = cacheService.getStats();
    log.info({ cacheStats }, 'Cache statistics');

    // Step 5: Close database connection
    log.info('Step 5: Closing database connection...');
    try {
      await prisma.$disconnect();
      log.info('Database connection closed.');
    } catch (error) {
      log.error({ err: error }, 'Error closing database connection');
    }

    clearTimeout(forceExitTimer);

    // Give TCP stack time to release sockets
    log.info('Waiting for socket cleanup...');
    setTimeout(() => {
      log.info('Shutdown complete.');
      process.exit(0);
    }, 500);
  } catch (error) {
    log.error({ err: error }, 'Error during shutdown');
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
};

process.on('SIGTERM', () => handleProcessSignal('SIGTERM'));
process.on('SIGINT', () => handleProcessSignal('SIGINT'));

// Startup recovery with cache warming
const startupRecovery = async () => {
  // Wait briefly for server to fully start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Cache warming
  log.info('Warming up cache...');
  await cacheService.warmup([
    {
      key: 'categories',
      factory: () => prisma.category.findMany(),
      ttl: 3600, // 1 hour
    },
    {
      key: 'themes',
      factory: () => prisma.theme.findMany(),
      ttl: 3600,
    },
    {
      key: 'projects',
      factory: () => prisma.project.findMany(),
      ttl: 1800, // 30 minutes
    },
  ]);

  const result = await orchestrator.recoverStaleExecutions();

  if (result.recoveredExecutions > 0) {
    log.info(
      {
        recoveredExecutions: result.recoveredExecutions,
        updatedTasks: result.updatedTasks,
        updatedSessions: result.updatedSessions,
      },
      `Startup recovery: ${result.recoveredExecutions} executions, ${result.updatedTasks} tasks, ${result.updatedSessions} sessions recovered`,
    );
  }

  // Check auto-resume setting and resume interrupted executions
  if (result.interruptedExecutionIds.length > 0) {
    try {
      const settings = await prisma.userSettings.findFirst();
      if (settings?.autoResumeInterruptedTasks) {
        // Additional wait for server to stabilize before auto-resume
        log.info(
          { count: result.interruptedExecutionIds.length },
          `Auto-resume enabled. Waiting for server to stabilize before resuming ${result.interruptedExecutionIds.length} executions...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));

        for (const executionId of result.interruptedExecutionIds) {
          try {
            const res = await fetch(
              `http://localhost:${PORT}/agents/executions/${executionId}/resume`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              },
            );
            const data = (await res.json()) as {
              success: boolean;
              taskTitle?: string;
              message?: string;
              error?: string;
            };
            if (data.success) {
              log.info(
                { executionId },
                `Auto-resumed execution ${executionId}: ${data.taskTitle || data.message}`,
              );
            } else {
              log.warn(
                { executionId, error: data.error },
                `Failed to auto-resume execution ${executionId}: ${data.error}`,
              );
            }
          } catch (error) {
            log.error({ err: error, executionId }, `Error auto-resuming execution ${executionId}`);
          }
        }

        // Create notification about auto-resume
        await prisma.notification
          .create({
            data: {
              type: 'agent_execution_resumed',
              title: 'Auto-resume completed',
              message: `After server restart, ${result.interruptedExecutionIds.length} interrupted tasks were automatically resumed.`,
              link: '/',
            },
          })
          .catch((err: Error) => {
            log.error({ err }, 'Failed to create auto-resume notification');
          });
      }
    } catch (error) {
      log.error({ err: error }, 'Auto-resume check failed');
    }
  }
};

startupRecovery().catch((error) => {
  log.error({ err: error }, 'Startup recovery failed');
});
