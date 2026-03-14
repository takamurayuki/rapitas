#!/usr/bin/env bun
/**
 * Development Server Script
 *
 * Watches TypeScript files and auto-restarts the server on changes.
 * Watches Prisma schema and auto-runs db push + generate on changes.
 * Cleans up zombie processes on the server port at startup.
 */

import { spawn, type Subprocess, spawnSync } from 'bun';
import { watch, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createLogger } from '../config/logger';

const pinoLog = createLogger('dev');

const ROOT_DIR = resolve(import.meta.dir, '..');
const PRISMA_SCHEMA = join(ROOT_DIR, 'prisma', 'schema.prisma');
const INDEX_FILE = join(ROOT_DIR, 'index.ts');
const ENV_FILE = join(ROOT_DIR, '.env');
const SERVER_PORT = parseInt(process.env.PORT || '3001', 10);

/** Loads .env file and sets environment variables. */
function loadEnvFile() {
  if (existsSync(ENV_FILE)) {
    const envContent = readFileSync(ENV_FILE, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          // Do not overwrite existing environment variables
          if (!process.env[key]) {
            process.env[key] = value.replace(/^["']|["']$/g, '');
          }
        }
      }
    }
    pinoLog.info(`Loaded environment variables from .env`);
  }
}

loadEnvFile();

let serverProcess: Subprocess | null = null;
let isRestarting = false;
let restartTimeout: ReturnType<typeof setTimeout> | null = null;

// Deferred restart management — restarts are postponed while agent executions are active
let hasDeferredChanges = false;
let deferredPrismaChange = false;
let deferredFiles: string[] = [];
let deferCheckInterval: ReturnType<typeof setInterval> | null = null;

const log = {
  info: (msg: string) => pinoLog.info(msg),
  success: (msg: string) => pinoLog.info(msg),
  warn: (msg: string) => pinoLog.warn(msg),
  error: (msg: string) => pinoLog.error(msg),
};

/** Kills all processes listening on the specified port. */
async function killProcessesOnPort(port: number): Promise<void> {
  const isWindows = process.platform === 'win32';

  try {
    if (isWindows) {
      const netstatResult = spawnSync({
        cmd: ['netstat', '-ano'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = new TextDecoder().decode(netstatResult.stdout as unknown as ArrayBuffer);
      const lines = output.split('\n');
      const pids = new Set<number>();

      for (const line of lines) {
        if (
          line.includes(`:${port}`) &&
          (line.includes('LISTENING') ||
            line.includes('ESTABLISHED') ||
            line.includes('TIME_WAIT') ||
            line.includes('CLOSE_WAIT'))
        ) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && pid > 0 && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }

      for (const pid of pids) {
        log.info(`Killing process on port ${port} (PID: ${pid})...`);
        try {
          const killResult = spawnSync({
            cmd: ['taskkill', '/PID', pid.toString(), '/T'],
            stdout: 'pipe',
            stderr: 'pipe',
          });

          // Force kill if graceful termination failed
          if (killResult.exitCode !== 0) {
            spawnSync({
              cmd: ['taskkill', '/PID', pid.toString(), '/T', '/F'],
              stdout: 'pipe',
              stderr: 'pipe',
            });
          }
          log.success(`Process (PID: ${pid}) terminated`);
        } catch {
          // Process already exited
        }
      }

      if (pids.size > 0) {
        // Wait for port to be released
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      // Linux/macOS: lsof + kill
      const lsofResult = spawnSync({
        cmd: ['lsof', '-t', `-i:${port}`],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = new TextDecoder().decode(lsofResult.stdout as unknown as ArrayBuffer).trim();
      if (output) {
        const pids = output
          .split('\n')
          .map((p) => parseInt(p, 10))
          .filter((p) => p > 0 && p !== process.pid);

        for (const pid of pids) {
          log.info(`Killing process on port ${port} (PID: ${pid})...`);
          try {
            spawnSync({
              cmd: ['kill', '-15', pid.toString()],
              stdout: 'pipe',
              stderr: 'pipe',
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            // Force kill if still alive
            spawnSync({
              cmd: ['kill', '-9', pid.toString()],
              stdout: 'pipe',
              stderr: 'pipe',
            });
            log.success(`Process (PID: ${pid}) terminated`);
          } catch {
            // Process already exited
          }
        }

        if (pids.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  } catch (error) {
    log.warn(`Error during port cleanup: ${error}`);
  }
}

/** Terminates the server process, waiting for graceful shutdown. */
async function killServerProcess(): Promise<void> {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  proc.kill();

  // Graceful shutdown may take up to 5 seconds
  const forceKillTimeout = setTimeout(() => {
    try {
      proc.kill(9); // SIGKILL
      log.warn('Force-killed server (shutdown timeout)');
    } catch {
      // Already exited
    }
  }, 5000);

  await proc.exited;
  clearTimeout(forceKillTimeout);

  // Wait for socket cleanup
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** Starts the backend server process. */
async function startServer(cleanupPort: boolean = false) {
  if (serverProcess) {
    log.info('Stopping server...');
    await killServerProcess();
    log.info('Server stopped');
  }

  // Port cleanup on first start or explicit request
  if (cleanupPort) {
    await killProcessesOnPort(SERVER_PORT);
  }

  log.info('Starting server...');
  serverProcess = spawn({
    cmd: ['bun', 'run', INDEX_FILE],
    cwd: ROOT_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  log.success(`Server started (http://localhost:${process.env.PORT || '3001'})`);
}

/** Handles Prisma schema changes: runs db push, generate, and restarts the server. */
async function handlePrismaChange() {
  log.info('Prisma schema change detected...');

  // Defer restart while agent executions are active
  const agentActive = await isAgentExecutionActive();
  if (agentActive) {
    hasDeferredChanges = true;
    deferredPrismaChange = true;
    deferredFiles.push('prisma/schema.prisma');
    log.warn(
      `Deferring Prisma restart — agent execution active (${deferredFiles.length} files queued)`,
    );
    startDeferredCheckInterval();
    return;
  }

  try {
    log.info('Running prisma db push...');
    const pushResult = spawn({
      cmd: ['bunx', 'prisma', 'db', 'push', '--skip-generate'],
      cwd: ROOT_DIR,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    await pushResult.exited;

    if (pushResult.exitCode !== 0) {
      log.error('prisma db push failed');
      return;
    }

    log.info('Running prisma generate...');
    const generateResult = spawn({
      cmd: ['bunx', 'prisma', 'generate'],
      cwd: ROOT_DIR,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    await generateResult.exited;

    if (generateResult.exitCode !== 0) {
      log.error('prisma generate failed');
      return;
    }

    log.success('Prisma schema update complete');

    await startServer();
  } catch (error) {
    log.error(`Prisma processing error: ${error}`);
  }
}

/**
 * Checks whether an agent execution is currently active by calling /agents/system-status.
 * When active, server restarts are deferred to avoid interrupting running agents.
 */
async function isAgentExecutionActive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/agents/system-status`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;

    const data = (await res.json()) as {
      activeExecutions?: number;
      runningExecutions?: number;
    };
    if (data && ((data.activeExecutions ?? 0) > 0 || (data.runningExecutions ?? 0) > 0)) {
      return true;
    }
    return false;
  } catch {
    // If the API is unresponsive, allow restart (safe default)
    return false;
  }
}

/**
 * Polls for agent completion, then applies deferred restarts.
 */
function startDeferredCheckInterval() {
  if (deferCheckInterval) return;
  deferCheckInterval = setInterval(async () => {
    if (!hasDeferredChanges) {
      clearInterval(deferCheckInterval!);
      deferCheckInterval = null;
      return;
    }
    const agentActive = await isAgentExecutionActive();
    if (!agentActive) {
      clearInterval(deferCheckInterval!);
      deferCheckInterval = null;
      const uniqueFiles = [...new Set(deferredFiles)].join(', ');
      log.info(`Agent completed. Applying deferred changes: ${uniqueFiles}`);
      const needsPrismaRestart = deferredPrismaChange;
      hasDeferredChanges = false;
      deferredPrismaChange = false;
      deferredFiles = [];
      if (needsPrismaRestart) {
        await handlePrismaChange();
      } else {
        if (isRestarting) return;
        isRestarting = true;
        try {
          await startServer();
        } finally {
          isRestarting = false;
        }
      }
    }
  }, 5000);
}

/** Schedules a debounced server restart; defers if an agent execution is active. */
function scheduleRestart(filename?: string) {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }

  restartTimeout = setTimeout(async () => {
    // Defer restart while agent execution is active
    const agentActive = await isAgentExecutionActive();
    if (agentActive) {
      hasDeferredChanges = true;
      if (filename) deferredFiles.push(filename);
      log.warn(`Deferring restart — agent execution active (${deferredFiles.length} files queued)`);
      startDeferredCheckInterval();
      return;
    }

    if (isRestarting) return;
    isRestarting = true;

    try {
      await startServer();
    } finally {
      isRestarting = false;
    }
  }, 300); // 300ms debounce
}

/** Watches TypeScript source directories for changes and triggers server restart. */
function watchTypeScriptFiles() {
  const watchDirs = ['services', 'utils', 'routes', 'config', 'middleware'];

  watch(INDEX_FILE, (eventType) => {
    if (eventType === 'change') {
      log.info('Change detected in index.ts');
      scheduleRestart('index.ts');
    }
  });

  for (const dirName of watchDirs) {
    const dirPath = join(ROOT_DIR, dirName);
    try {
      watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (filename?.endsWith('.ts')) {
          log.info(`Change detected in ${dirName}/${filename}`);
          scheduleRestart(`${dirName}/${filename}`);
        }
      });
    } catch {
      // Directory does not exist — skip
    }
  }

  log.info('Watching TypeScript files for changes');
  log.info(`Watched: index.ts, ${watchDirs.join(', ')}`);
}

/** Watches the Prisma schema file for changes. */
function watchPrismaSchema() {
  let lastChangeTime = 0;

  watch(PRISMA_SCHEMA, async (eventType) => {
    if (eventType === 'change') {
      // Debounce rapid successive change events
      const now = Date.now();
      if (now - lastChangeTime < 1000) return;
      lastChangeTime = now;

      await handlePrismaChange();
    }
  });

  log.info('Watching Prisma schema for changes');
}

let isCleaningUp = false;
async function cleanup(signal: string) {
  if (isCleaningUp) return;
  isCleaningUp = true;

  log.info(`Received ${signal}, shutting down...`);

  // Force exit after 5 seconds if graceful shutdown stalls
  const forceExitTimer = setTimeout(() => {
    log.error('Graceful shutdown timeout, forcing exit...');
    process.exit(1);
  }, 5000);

  if (serverProcess) {
    try {
      serverProcess.kill();

      // Wait up to 2 seconds for process exit
      const exitPromise = serverProcess.exited;
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2000));
      await Promise.race([exitPromise, timeoutPromise]);

      // Force kill if still alive
      if (serverProcess) {
        try {
          serverProcess.kill(9);
        } catch {
          // Already exited
        }
      }

      log.success('Server process terminated');
    } catch (error) {
      log.error(`Server termination error: ${error}`);
    }
  }

  clearTimeout(forceExitTimer);
  process.exit(0);
}

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

async function main() {
  pinoLog.info('╔════════════════════════════════════════════╗');
  pinoLog.info('║     Rapitas Backend Dev Server              ║');
  pinoLog.info('╠════════════════════════════════════════════╣');
  pinoLog.info('║  • TypeScript changes  → auto restart      ║');
  pinoLog.info('║  • Prisma schema change → auto db push     ║');
  pinoLog.info('║  • Ctrl+C to quit                          ║');
  pinoLog.info('╚════════════════════════════════════════════╝');

  log.info('Initial startup: syncing Prisma schema...');
  const pushResult = spawn({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    cwd: ROOT_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  await pushResult.exited;

  watchTypeScriptFiles();
  watchPrismaSchema();

  // First start includes port cleanup
  await startServer(true);
}

main().catch((error) => {
  log.error(`Startup error: ${error}`);
  process.exit(1);
});
