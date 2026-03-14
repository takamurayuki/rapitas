/**
 * Agent System Router
 *
 * Handles diagnostics, system status, encryption checks, and graceful shutdown.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config/database';
import { orchestrator, stopServer } from '../../services/orchestrator-instance';
import { isEncryptionKeyConfigured } from '../../utils/encryption';
import { realtimeService } from '../../services/realtime-service';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:agent-system');

export const agentSystemRouter = new Elysia({ prefix: '/agents' })

  .get('/encryption-status', async () => {
    return {
      isConfigured: isEncryptionKeyConfigured(),
      message: isEncryptionKeyConfigured()
        ? 'Encryption key is properly configured'
        : 'Warning: Encryption key is not set in environment variables. Must be configured for production.',
    };
  })

  .get('/diagnose', async () => {
    const { spawn } = await import('child_process');
    const claudePath = process.env.CLAUDE_CODE_PATH || 'claude';

    log.info('[Diagnose] Testing Claude CLI...');
    log.info({ claudePath }, '[Diagnose] Claude path');
    log.info({ platform: process.platform }, '[Diagnose] Platform');

    const results: {
      step: string;
      success: boolean;
      output?: string;
      error?: string;
      duration?: number;
    }[] = [];

    const versionResult = await new Promise<{
      success: boolean;
      output?: string;
      error?: string;
      duration: number;
    }>((resolve) => {
      const startTime = Date.now();
      const proc = spawn(claudePath, ['--version'], { shell: true });
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          error: 'Timeout (10s)',
          duration: Date.now() - startTime,
        });
      }, 10000);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          output: stdout.trim(),
          error: stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: err.message,
          duration: Date.now() - startTime,
        });
      });
    });

    results.push({ step: 'claude --version', ...versionResult });
    log.info({ versionResult }, '[Diagnose] Version check');

    if (versionResult.success) {
      const promptResult = await new Promise<{
        success: boolean;
        output?: string;
        error?: string;
        duration: number;
      }>((resolve) => {
        const startTime = Date.now();

        const isWindows = process.platform === 'win32';
        let proc;

        if (isWindows) {
          const fullCommand = `${claudePath} --dangerously-skip-permissions -p "Say hello"`;
          log.info({ fullCommand }, '[Diagnose] Windows full command');
          proc = spawn('cmd.exe', ['/c', fullCommand], {
            env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
            windowsHide: true,
          });
        } else {
          proc = spawn(claudePath, ['--dangerously-skip-permissions', '-p', 'Say hello'], {
            env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
          });
        }

        let stdout = '';
        let stderr = '';

        const timeout = setTimeout(() => {
          log.info('[Diagnose] Timeout, killing process');
          proc.kill();
          resolve({
            success: false,
            error: 'Timeout (90s)',
            duration: Date.now() - startTime,
          });
        }, 90000);

        proc.stdout?.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          log.info({ chunk: chunk.substring(0, 100) }, '[Diagnose] stdout chunk');
        });

        proc.stderr?.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          log.info({ chunk: chunk.substring(0, 100) }, '[Diagnose] stderr chunk');
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          log.info({ code, stdoutLength: stdout.length }, '[Diagnose] Process closed');
          resolve({
            success: code === 0,
            output: stdout.substring(0, 500),
            error: stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
            duration: Date.now() - startTime,
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          log.info({ err }, '[Diagnose] Process error');
          resolve({
            success: false,
            error: err.message,
            duration: Date.now() - startTime,
          });
        });
      });

      results.push({ step: 'simple prompt test', ...promptResult });
      log.info({ promptResult }, '[Diagnose] Prompt test result');
    }

    return {
      claudePath,
      platform: process.platform,
      results,
      allPassed: results.every((r) => r.success),
    };
  })

  .get('/system-status', async () => {
    const activeExecutions = orchestrator.getActiveExecutionCount?.() || 0;
    const isShuttingDown = orchestrator.isInShutdown();

    const runningExecutions = await prisma.agentExecution.count({
      where: {
        status: { in: ['running', 'pending'] },
      },
    });

    const interruptedExecutions = await prisma.agentExecution.count({
      where: {
        status: 'interrupted',
      },
    });

    let status = 'healthy';
    if (isShuttingDown) status = 'shutting_down';
    else if (activeExecutions > 0) status = 'busy';
    else if (interruptedExecutions > 0) status = 'interrupted_executions';

    return {
      status,
      isShuttingDown,
      activeExecutions,
      runningExecutions,
      interruptedExecutions,
      serverTime: new Date().toISOString(),
    };
  })

  // Validate agent configuration
  .get('/validate-config', async () => {
    try {
      const agentConfigs = await prisma.aIAgentConfig.findMany({
        select: {
          id: true,
          name: true,
          agentType: true,
          isActive: true,
        },
      });

      let isValid = true;
      const errors: string[] = [];

      const activeConfigs = agentConfigs.filter((config) => config.isActive);
      if (activeConfigs.length === 0) {
        isValid = false;
        errors.push('No active agent configurations found');
      }

      if (!isEncryptionKeyConfigured()) {
        isValid = false;
        errors.push('Encryption key not configured');
      }

      return {
        isValid,
        totalConfigs: agentConfigs.length,
        activeConfigs: activeConfigs.length,
        errors,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        timestamp: new Date().toISOString(),
      };
    }
  })

  // Health check endpoint
  .get('/health', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      return {
        status: 'healthy',
        database: 'connected',
        encryption: isEncryptionKeyConfigured() ? 'configured' : 'not_configured',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return Response.json(
        {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }
  })

  // Graceful shutdown endpoint (called by dev.js before stopping)
  .post('/shutdown', async () => {
    try {
      log.info('[shutdown] Graceful shutdown requested via API');

      const activeCount = orchestrator.getActiveExecutionCount();

      setTimeout(async () => {
        try {
          log.info('[shutdown] Closing all SSE connections...');
          realtimeService.shutdown();

          log.info('[shutdown] Closing listening socket first for quick port release...');
          await stopServer();
          log.info('[shutdown] Listening socket closed, port released.');

          log.info('[shutdown] Stopping agents and saving state...');
          await orchestrator.gracefulShutdown({ skipServerStop: true });
          log.info('[shutdown] Agent shutdown completed.');
        } catch (error) {
          log.error({ err: error }, '[shutdown] Graceful shutdown error');
        } finally {
          log.info('[shutdown] Exiting process...');
          setTimeout(() => process.exit(0), 200);
        }
      }, 300);

      return {
        success: true,
        message: 'Graceful shutdown initiated',
        activeExecutions: activeCount,
      };
    } catch (error) {
      log.error({ err: error }, '[shutdown] Error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initiate shutdown',
      };
    }
  })

  // Server restart endpoint (called by frontend or dev tools)
  // Performs graceful shutdown then exits with code 75 to signal dev.js to restart
  .post('/restart', async () => {
    try {
      log.info('[restart] Server restart requested via API');

      const activeCount = orchestrator.getActiveExecutionCount();

      setTimeout(async () => {
        try {
          log.info('[restart] Closing all SSE connections...');
          realtimeService.shutdown();

          log.info('[restart] Closing listening socket first for quick port release...');
          await stopServer();
          log.info('[restart] Listening socket closed, port released.');

          log.info('[restart] Stopping agents and saving state...');
          await orchestrator.gracefulShutdown({ skipServerStop: true });
          log.info('[restart] Agent shutdown completed.');
        } catch (error) {
          log.error({ err: error }, '[restart] Graceful shutdown error');
        } finally {
          log.info('[restart] Exiting with restart code...');
          setTimeout(() => process.exit(75), 200);
        }
      }, 300);

      return {
        success: true,
        message: 'Server restart initiated. Server will stop and restart automatically.',
        activeExecutions: activeCount,
      };
    } catch (error) {
      log.error({ err: error }, '[restart] Error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initiate restart',
      };
    }
  });
