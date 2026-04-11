#!/usr/bin/env bun
/**
 * Production Server Script with Dynamic Port Selection
 *
 * Automatically finds an available port if the default port is in use.
 * Used for production deployments where port conflicts may occur.
 */

import { spawn, spawnSync } from 'bun';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createLogger } from '../config/logger';
import { findAvailablePort } from '../utils/common/find-port';

const pinoLog = createLogger('start');
const log = {
  info: (msg: string) => pinoLog.info(msg),
  success: (msg: string) => pinoLog.info(msg),
  warn: (msg: string) => pinoLog.warn(msg),
  error: (msg: string) => pinoLog.error(msg),
};

const ROOT_DIR = resolve(import.meta.dir, '..');
const INDEX_FILE = resolve(ROOT_DIR, 'index.ts');
const ENV_FILE = resolve(ROOT_DIR, '.env');
const DEFAULT_PORT = parseInt(process.env.PORT || '3001', 10);

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
    log.info('Loaded environment variables from .env');
  }
}

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

async function main() {
  loadEnvFile();

  pinoLog.info('╔════════════════════════════════════════════╗');
  pinoLog.info('║     Rapitas Backend Production Server      ║');
  pinoLog.info('╚════════════════════════════════════════════╝');

  // Find an available port
  let serverPort: number;
  try {
    log.info(`Checking port availability starting from ${DEFAULT_PORT}...`);
    serverPort = await findAvailablePort(DEFAULT_PORT);

    if (serverPort !== DEFAULT_PORT) {
      log.warn(`Port ${DEFAULT_PORT} is in use. Using port ${serverPort} instead.`);
    } else {
      log.info(`Using default port ${serverPort}`);
    }

    // Clean up any existing processes on the selected port
    await killProcessesOnPort(serverPort);
  } catch (error) {
    log.error(`Failed to find available port: ${error}`);
    process.exit(1);
  }

  // Start the production server
  log.info('Starting production server...');
  const serverProcess = spawn({
    cmd: ['bun', 'run', INDEX_FILE],
    cwd: ROOT_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, FORCE_COLOR: '1', PORT: serverPort.toString() },
  });

  log.success(`Production server started (http://localhost:${serverPort})`);

  // Handle graceful shutdown
  const cleanup = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);

    if (serverProcess) {
      try {
        serverProcess.kill();
        await serverProcess.exited;
        log.success('Server process terminated');
      } catch (error) {
        log.error(`Server termination error: ${error}`);
      }
    }

    process.exit(0);
  };

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));

  // Wait for the server process to exit
  await serverProcess.exited;
}

main().catch((error) => {
  log.error(`Startup error: ${error}`);
  process.exit(1);
});
