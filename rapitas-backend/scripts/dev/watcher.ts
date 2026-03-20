/**
 * File Watcher
 *
 * Watches TypeScript source directories and the Prisma schema for changes,
 * scheduling debounced server restarts. Defers restarts while agent
 * executions are active and polls until they complete.
 */
import { spawn } from 'bun';
import { watch } from 'fs';
import { join } from 'path';
import { startServer, ROOT_DIR, INDEX_FILE, getServerPort, log } from './server-manager';

// NOTE: These module-level variables track deferred-restart state across watch callbacks.
let isRestarting = false;
let restartTimeout: ReturnType<typeof setTimeout> | null = null;

let hasDeferredChanges = false;
let deferredPrismaChange = false;
let deferredFiles: string[] = [];
let deferCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Checks whether an agent execution is currently active by polling /agents/system-status.
 * When active, server restarts are deferred to avoid interrupting running agents.
 *
 * @returns True if any execution is running / 実行中のエージェントが存在する場合はtrue
 */
export async function isAgentExecutionActive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`http://127.0.0.1:${getServerPort()}/agents/system-status`, {
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
 * Handles Prisma schema changes: runs db push, generate, and restarts the server.
 * Defers the operation if an agent execution is active.
 */
export async function handlePrismaChange(): Promise<void> {
  log.info('Prisma schema change detected...');

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
 * Polls for agent completion, then applies deferred restarts.
 * No-op if already polling.
 */
function startDeferredCheckInterval(): void {
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

/**
 * Schedules a debounced server restart (300 ms); defers if an agent execution is active.
 *
 * @param filename - Changed file name for log/deferred tracking / 変更されたファイル名
 */
export function scheduleRestart(filename?: string): void {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }

  restartTimeout = setTimeout(async () => {
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
  }, 300); // NOTE: 300ms debounce prevents bursts of rapid saves from triggering multiple restarts.
}

/**
 * Watches TypeScript source directories for changes and triggers a server restart.
 */
export function watchTypeScriptFiles(): void {
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

/**
 * Watches the Prisma schema file for changes and triggers db push + generate + restart.
 */
export function watchPrismaSchema(): void {
  const PRISMA_SCHEMA = join(ROOT_DIR, 'prisma', 'schema.prisma');
  let lastChangeTime = 0;

  watch(PRISMA_SCHEMA, async (eventType) => {
    if (eventType === 'change') {
      // NOTE: 1-second guard prevents duplicate events fired by some editors on save.
      const now = Date.now();
      if (now - lastChangeTime < 1000) return;
      lastChangeTime = now;

      await handlePrismaChange();
    }
  });

  log.info('Watching Prisma schema for changes');
}
