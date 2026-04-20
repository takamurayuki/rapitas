// Setup global error handlers
import { setupGlobalErrorHandlers, errorHandler } from './middleware';
setupGlobalErrorHandlers();

import { createLogger } from './config/logger';
const log = createLogger('server');

// Validate environment variables at startup
import { validateEnvironment } from './config/env-validation';
validateEnvironment();

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';

// All modular routes are registered via registerAllRoutes() in register-routes.ts.
import { registerAllRoutes } from './register-routes';

// Import shared database client
import { prisma, ensureDatabaseConnection } from './config';

// Import worker manager for agent process lifecycle
import {
  orchestrator,
  workerManager,
  setServerStopCallback,
} from './services/core/orchestrator-instance';

// Import realtime service for SSE cleanup on shutdown
import { realtimeService } from './services/communication/realtime-service';

// Ensure database connection before starting server
await ensureDatabaseConnection();

const app = new Elysia();

// Apply middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:3000', 'http://127.0.0.1:3000', 'tauri://localhost'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// Ensure all responses are JSON formatted
app.onBeforeHandle(({ set }) => {
  set.headers['Content-Type'] = 'application/json; charset=utf-8';
});

// Apply error handler middleware (ensures JSON error responses)
app.use(errorHandler);

// Swagger documentation
app.use(
  swagger({
    documentation: {
      info: {
        title: 'Rapitas API',
        version: '1.0.0',
        description: 'Rapitas - AI-powered task management and development automation API',
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

// Apply all modular routes (82 Elysia instances, organized by domain)
registerAllRoutes(app);

// Start behavior scheduler
import { BehaviorScheduler } from './src/services/behavior-scheduler';
BehaviorScheduler.start();

// Initialize memory system
import { initializeMemorySystem, shutdownMemorySystem } from './services/memory';
initializeMemorySystem().catch((error) => {
  log.error({ err: error }, 'Failed to initialize memory system');
});

// Initialize AI Orchestra recovery
import { AIOrchestra } from './services/workflow/ai-orchestra';
AIOrchestra.getInstance()
  .recoverOnStartup()
  .catch((error) => {
    log.error({ err: error }, 'AI Orchestra startup recovery failed');
  });

// Initialize Agent Worker Manager for processing agent execution in separate processes
workerManager.initialize().catch((error) => {
  log.error({ err: error }, 'Failed to initialize Agent Worker Manager');
});

// Start server
const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen({
  port: PORT,
  hostname: '0.0.0.0', // IPv4 only - prevents IPv6 zombie socket interference
  idleTimeout: 30, // 30-second idle timeout to prevent CLOSE_WAIT accumulation
  reusePort: true, // allows binding even with TIME_WAIT zombie sockets
});
log.info(`Rapitas backend running on http://127.0.0.1:${PORT}`);

// Set server stop callback for proper port release during graceful shutdown
setServerStopCallback(() => {
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

    // Step 1.5: Stop AI Orchestra runner
    log.info('Step 1.5: Stopping AI Orchestra runner...');
    try {
      const { WorkflowRunner } = await import('./services/workflow/workflow-runner');
      await WorkflowRunner.getInstance().stopProcessing();
    } catch (error) {
      log.error({ err: error }, 'Error stopping workflow runner');
    }

    // Step 1.6: Stop memory system
    log.info('Step 1.6: Stopping memory system...');
    shutdownMemorySystem();

    // Step 2: Close all SSE connections (cleanup existing connections)
    log.info('Step 2: Closing SSE connections...');
    const clientCount = realtimeService.getClientCount();
    realtimeService.shutdown();
    log.info({ clientCount }, `Closed ${clientCount} SSE client(s).`);

    // Step 3: Wait for connections to drain
    // Need some time for TCP sockets to close completely
    log.info('Step 3: Waiting for connections to drain...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 3.5: Local LLM server cleanup
    log.info('Step 3.5: Cleaning up local LLM server...');
    try {
      const { cleanupLocalLLM } = await import('./services/local-llm');
      cleanupLocalLLM();
    } catch {
      // ignore if module not loaded
    }

    // Step 4: Shutdown Agent Worker Manager
    log.info('Step 4: Shutting down Agent Worker Manager...');
    try {
      await workerManager.gracefulShutdown();
      log.info('Agent Worker Manager shutdown completed.');
    } catch (error) {
      log.error({ err: error }, 'Error shutting down Agent Worker Manager');
    }

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

// Startup recovery: mark stale running/pending executions as interrupted
// and update related Task/Session statuses, then auto-resume if enabled
const startupRecovery = async () => {
  // Wait for worker process to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Additional wait until worker is ready
  let retries = 0;
  while (!workerManager.getIsWorkerReady() && retries < 20) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    retries++;
  }

  if (!workerManager.getIsWorkerReady()) {
    log.warn('Startup recovery skipped: Worker not ready after 20s');
    return;
  }

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
