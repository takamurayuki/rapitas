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
import { listWindowsProcessSnapshot, collectKillTargets } from './process-tree-kill';

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
 * Count tracked processes of a role whose PID is still alive. Consumed by the
 * task-boundary restart governance (quiescence condition b: no live auxiliary
 * CLI children). Stale PID files (dead process, unparsable content) are
 * removed on the way, so a leaked file can never pin the count above zero
 * forever and permanently block the boundary restart.
 *
 * @param role - Tracked role to count / 集計対象のロール
 * @returns Number of live tracked processes for the role / 生存中の追跡プロセス数
 */
export function countLiveTrackedProcesses(role: ProcessInfo['role']): number {
  try {
    if (!existsSync(PID_DIR)) {
      return 0;
    }
    const files = readdirSync(PID_DIR).filter(
      (f) => f.startsWith(`${role}-`) && f.endsWith('.pid'),
    );
    let live = 0;
    for (const file of files) {
      const filepath = join(PID_DIR, file);
      try {
        const info: ProcessInfo = JSON.parse(readFileSync(filepath, 'utf-8'));
        if (isProcessAlive(info.pid)) {
          live++;
        } else {
          unlinkSync(filepath);
        }
      } catch {
        // Unparsable = untrackable; remove so it cannot inflate future counts.
        try {
          unlinkSync(filepath);
        } catch {
          // ignore
        }
      }
    }
    return live;
  } catch (error) {
    // NOTE: Fail-open (0): an fs error must not wedge the boundary restart forever.
    logger.warn({ err: error, role }, '[ProcessTracker] Failed to count live processes');
    return 0;
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
 * Force-kill a process tree, enforcing the port-3001 protection.
 *
 * Used to reap an agent CLI process that lingered after its run completed
 * (on Windows, stdio 'close' does not guarantee the process exited, so a done
 * `claude --print` can stay resident as a zombie), and to tear down launched
 * app-under-test trees. On Windows the target set comes from a full process
 * snapshot, not just `taskkill /T` — a dead intermediate parent (e.g.
 * tauri-cli exiting while its BeforeDevCommand `pnpm dev` subtree keeps
 * running) breaks /T's live-link traversal and used to leak CPU-spinning dev
 * servers. Passing `workdir` (a `.worktrees` path) additionally sweeps
 * orphans reachable only by command-line match. NEVER kills a process
 * listening on port 3001 (the backend).
 *
 * @param pid - Root process ID of the tree / 終了対象ツリーのルートPID
 * @param opts.workdir - Launch cwd for orphan matching / 起動時の作業ディレクトリ
 * @returns true if a kill was issued / killを実行したら true
 */
export function killProcessTreeSafely(pid: number, opts: { workdir?: string } = {}): boolean {
  try {
    const targets = new Set<number>();
    if (isProcessAlive(pid)) targets.add(pid);
    if (process.platform === 'win32') {
      // Snapshot-based enumeration also catches subtrees whose live parent
      // link is gone; [] on enumeration failure degrades to plain /T below.
      const snapshot = listWindowsProcessSnapshot();
      for (const t of collectKillTargets(snapshot, pid, opts.workdir)) targets.add(t);
    }
    if (targets.size === 0) return false;

    for (const t of [...targets]) {
      if (isListeningOnBackendPort(t)) {
        logger.warn(
          { pid: t },
          '[ProcessTracker] Refusing to kill — listening on port 3001 (backend protection)',
        );
        targets.delete(t);
      }
    }
    if (targets.size === 0) return false;

    if (process.platform === 'win32') {
      // /T still covers children spawned after the snapshot; the explicit
      // /PID list covers members /T cannot reach through dead parents.
      const pidArgs = [...targets].map((t) => `/PID ${t}`).join(' ');
      execSync(`taskkill /F /T ${pidArgs}`, { stdio: 'pipe', timeout: 15_000 });
    } else {
      for (const t of targets) process.kill(t, 'SIGKILL');
    }
    logger.info({ pid, killed: [...targets] }, '[ProcessTracker] Reaped lingering process tree');
    return true;
  } catch (err) {
    // Most failures mean the process already exited between the check and kill.
    logger.debug(
      { err, pid },
      '[ProcessTracker] killProcessTreeSafely no-op (likely already gone)',
    );
    return false;
  }
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
