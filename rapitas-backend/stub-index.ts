#!/usr/bin/env bun
/**
 * Stub Backend Server for CI/CD
 *
 * Provides minimal API endpoints so the frontend can operate during CI/CD builds.
 */
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { createLogger } from './config/logger';

const log = createLogger('stub-server');

const app = new Elysia();

app.use(cors());

app.get('/health', () => ({
  status: 'ok',
  message: 'CI/CD Stub Backend',
  timestamp: new Date().toISOString(),
}));

const stubResponse = {
  message: 'This is a stub response from CI/CD build. Database not connected.',
  data: [],
};

app.get('/tasks', () => stubResponse);
app.get('/tasks/:id', (context) => ({
  ...stubResponse,
  id: context.params.id,
  title: 'Stub Task',
}));

app.get('/themes', () => stubResponse);
app.get('/themes/:id', (context) => ({
  ...stubResponse,
  id: context.params.id,
  name: 'Stub Theme',
}));

app.get('/projects', () => stubResponse);
app.get('/projects/:id', (context) => ({
  ...stubResponse,
  id: context.params.id,
  name: 'Stub Project',
}));

app.get('/settings', () => ({
  autoResumeInterruptedTasks: false, // Disabled — not needed in stub environment
  enableDeveloperMode: false,
  enableAgentExecution: false,
  enableParallelExecution: false,
  maxParallelExecutions: 1,
  autoRetryOnRateLimit: false,
  rateLimitRetryDelay: 5,
}));

app.get('/agents/resumable-executions', () => []);

app.post('/agents/executions/:id/resume', (context) => ({
  success: false,
  message: 'Stub backend: execution resume not available',
  executionId: context.params.id,
}));

app.post('/agents/executions/:id/acknowledge', (context) => ({
  success: true,
  message: 'Acknowledged (stub)',
  executionId: context.params.id,
}));

app.get('/sse', (context) => {
  const { set } = context;
  set.headers['Content-Type'] = 'text/event-stream';
  set.headers['Cache-Control'] = 'no-cache';
  set.headers['Connection'] = 'keep-alive';

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue('data: {"type":"connected","message":"CI/CD Stub SSE"}\n\n');
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    },
  );
});

app.onError(({ code, error }) => {
  if (code === 'NOT_FOUND') {
    return {
      error: 'Not Found',
      message: 'This endpoint is not available in CI/CD stub backend',
      stub: true,
    };
  }
  return {
    error: error instanceof Error ? error.message : String(error),
    stub: true,
  };
});

// Check for version flag (for CI/CD build testing)
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  log.info('CI/CD Stub Backend v1.0.0');
  process.exit(0);
}

// Check for CI environment flag
const isCI = process.env.CI === 'true';
const CI_TIMEOUT = 5000; // 5 seconds timeout in CI

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen({
  port: PORT,
  reusePort: true,
});

log.info(`CI/CD Stub Backend running on http://localhost:${PORT}`);
log.warn('This is a minimal stub server for CI/CD builds.');
log.warn('Database functionality is not available.');

// Auto-exit after timeout in CI environment
if (isCI) {
  log.info({ timeoutMs: CI_TIMEOUT }, `CI mode: Auto-exit after ${CI_TIMEOUT}ms`);
  setTimeout(() => {
    log.info('CI timeout reached, exiting...');
    process.exit(0);
  }, CI_TIMEOUT);
}

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down...');
  process.exit(0);
});
