#!/usr/bin/env bun
/**
 * Development Server Script
 *
 * Entry point for the dev watcher. Delegates to sub-modules for size compliance:
 *   - dev/port-utils.ts    — cross-platform port cleanup
 *   - dev/server-manager.ts — subprocess lifecycle
 *   - dev/watcher.ts       — TS/Prisma file watchers and deferred restart logic
 */

import { spawn } from 'bun';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createLogger } from '../config/logger';
import { findAvailablePort } from '../utils/common/find-port';
import {
  serverProcess,
  log,
  ROOT_DIR,
  setServerPort,
  startServer,
} from './dev/server-manager';
import { watchTypeScriptFiles, watchPrismaSchema } from './dev/watcher';

const pinoLog = createLogger('dev');

const ENV_FILE = join(resolve(import.meta.dir, '..'), '.env');
const DEFAULT_PORT = parseInt(process.env.PORT || '3001', 10);

/** Loads .env file and sets environment variables without overwriting existing ones. */
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

let isCleaningUp = false;

/** Handles process signals for graceful shutdown. */
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

  try {
    log.info(`Checking port availability starting from ${DEFAULT_PORT}...`);
    const port = await findAvailablePort(DEFAULT_PORT);
    setServerPort(port);

    if (port !== DEFAULT_PORT) {
      log.warn(`Port ${DEFAULT_PORT} is in use. Using port ${port} instead.`);
    } else {
      log.info(`Using default port ${port}`);
    }
  } catch (error) {
    log.error(`Failed to find available port: ${error}`);
    process.exit(1);
  }

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
