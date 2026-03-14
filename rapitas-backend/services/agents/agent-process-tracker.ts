/**
 * AgentProcessTracker
 *
 * Persists agent-related process PIDs to files so that zombie processes
 * can be tracked and cleaned up after a crash.
 * NOTE: Never kills processes listening on port 3001 (backend server) — per CLAUDE.md constraint.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createLogger } from '../../config/logger';

const logger = createLogger('agent-process-tracker');

/** Process info recorded in PID files. */
interface ProcessInfo {
  pid: number;
  role: 'worker' | 'cli-agent';
  taskId?: number;
  executionId?: number;
  startedAt: string;
  parentPid: number;
}

const PID_DIR = join(process.cwd(), '.agent-pids');

/**
 * Ensure the PID directory exists.
 */
function ensurePidDir(): void {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
}

/**
 * Check whether a process is still alive (cross-platform).
 *
 * @param pid - Process ID to check / チェック対象のプロセスID
 * @returns true if the process is alive / 生存していれば true
 */
function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        stdio: 'pipe',
        timeout: 5000,
      }).toString();
      // NOTE: tasklist returns a Japanese message when no matching process is found
      return result.includes(String(pid));
    }
    // Unix: signal 0 checks if process is alive without sending a real signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a PID is listening on port 3001.
 * Safety check before kill — enforces the CLAUDE.md constraint.
 *
 * @param pid - Process ID to check / チェック対象のプロセスID
 * @returns true if listening on port 3001 / ポート3001をLISTENしていれば true
 */
function isListeningOnBackendPort(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`netstat -aon | findstr ":3001 " | findstr "LISTEN"`, {
        stdio: 'pipe',
        timeout: 5000,
      }).toString();
      return result.includes(String(pid));
    }
    const result = execSync(`lsof -iTCP:3001 -sTCP:LISTEN -t 2>/dev/null`, {
      stdio: 'pipe',
      timeout: 5000,
    }).toString();
    return result.trim().split('\n').includes(String(pid));
  } catch {
    return false;
  }
}

/**
 * Write a PID file for an agent-related process.
 *
 * @param info - Process info to register / 登録対象のプロセス情報
 */
export function registerProcess(info: ProcessInfo): void {
  try {
    ensurePidDir();
    const filename = `${info.role}-${info.pid}.pid`;
    const filepath = join(PID_DIR, filename);
    writeFileSync(filepath, JSON.stringify(info, null, 2), 'utf-8');
    logger.info({ pid: info.pid, role: info.role }, '[ProcessTracker] Registered process');
  } catch (error) {
    logger.error({ err: error }, '[ProcessTracker] Failed to register process');
  }
}

/**
 * Remove a PID file to stop tracking a process.
 *
 * @param pid - Process ID to unregister / 対象プロセスID
 */
export function unregisterProcess(pid: number): void {
  try {
    const files = existsSync(PID_DIR) ? readdirSync(PID_DIR) : [];
    for (const file of files) {
      if (file.includes(`-${pid}.pid`)) {
        unlinkSync(join(PID_DIR, file));
        logger.info({ pid }, '[ProcessTracker] Unregistered process');
        return;
      }
    }
  } catch (error) {
    logger.error({ err: error, pid }, '[ProcessTracker] Failed to unregister process');
  }
}

/**
 * Scan all PID files, kill zombie processes, and remove their PID files.
 * Protects any process listening on port 3001.
 *
 * @returns Number of processes killed / killしたプロセス数
 */
export function cleanupZombieProcesses(): number {
  let killedCount = 0;

  try {
    if (!existsSync(PID_DIR)) {
      return 0;
    }

    const files = readdirSync(PID_DIR).filter((f) => f.endsWith('.pid'));
    if (files.length === 0) {
      return 0;
    }

    logger.info(
      { count: files.length },
      '[ProcessTracker] Scanning PID files for zombie processes',
    );

    for (const file of files) {
      const filepath = join(PID_DIR, file);
      try {
        const content = readFileSync(filepath, 'utf-8');
        const info: ProcessInfo = JSON.parse(content);

        if (!isProcessAlive(info.pid)) {
          unlinkSync(filepath);
          logger.info(
            { pid: info.pid, role: info.role },
            '[ProcessTracker] Removed stale PID file',
          );
          continue;
        }

        // NOTE: Protect processes listening on port 3001 — they may be the backend server itself
        if (isListeningOnBackendPort(info.pid)) {
          logger.warn(
            { pid: info.pid },
            '[ProcessTracker] Skipping process — listening on port 3001 (backend protection)',
          );
          unlinkSync(filepath);
          continue;
        }

        logger.info({ pid: info.pid, role: info.role }, '[ProcessTracker] Killing zombie process');
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${info.pid}`, { stdio: 'pipe', timeout: 5000 });
          } else {
            process.kill(info.pid, 'SIGKILL');
          }
          killedCount++;
        } catch (killError) {
          // NOTE: Kill failure likely means the process already exited — non-fatal
          logger.debug(
            { err: killError, pid: info.pid },
            '[ProcessTracker] Kill failed (process may have exited)',
          );
        }

        unlinkSync(filepath);
      } catch (fileError) {
        logger.warn({ err: fileError, file }, '[ProcessTracker] Invalid PID file, removing');
        try {
          unlinkSync(filepath);
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[ProcessTracker] Failed to cleanup zombie processes');
  }

  if (killedCount > 0) {
    logger.info({ killedCount }, '[ProcessTracker] Zombie cleanup complete');
  }

  return killedCount;
}

/**
 * Delete all PID files without killing processes (for dev.js startup cleanup).
 */
export function clearAllPidFiles(): void {
  try {
    if (!existsSync(PID_DIR)) {
      return;
    }

    const files = readdirSync(PID_DIR).filter((f) => f.endsWith('.pid'));
    for (const file of files) {
      try {
        unlinkSync(join(PID_DIR, file));
      } catch {
        // ignore
      }
    }

    if (files.length > 0) {
      logger.info({ count: files.length }, '[ProcessTracker] Cleared all PID files');
    }
  } catch (error) {
    logger.error({ err: error }, '[ProcessTracker] Failed to clear PID files');
  }
}
