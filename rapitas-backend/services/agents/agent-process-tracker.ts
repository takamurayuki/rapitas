/**
 * Agent Process Tracker
 *
 * エージェント関連プロセスのPIDをファイルとして永続化し、
 * プロセスクラッシュ後もゾンビプロセスを追跡・クリーンアップ可能にする。
 * ポート3001（バックエンドサーバー）のプロセスは絶対にkillしない。
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createLogger } from '../../config/logger';

const logger = createLogger('agent-process-tracker');

/** PIDファイルに記録するプロセス情報 */
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
 * PIDディレクトリが存在しなければ作成する。
 */
function ensurePidDir(): void {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
}

/**
 * プロセスが生存しているかチェックする（Windows対応）。
 *
 * @param pid - チェック対象のプロセスID / 対象プロセスID
 * @returns 生存していれば true / 生存していれば true
 */
function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        stdio: 'pipe',
        timeout: 5000,
      }).toString();
      // tasklist は該当なしの場合 "情報: 指定された条件に一致するタスクは実行されていません。" を返す
      return result.includes(String(pid));
    }
    // Unix: signal 0 で生存確認
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 指定PIDがポート3001をLISTENしているかチェックする。
 * kill前の安全確認用 — CLAUDE.md制約遵守。
 *
 * @param pid - チェック対象のプロセスID / 対象プロセスID
 * @returns ポート3001をLISTENしていれば true / LISTENしていれば true
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
    // Unix
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
 * エージェント関連プロセスのPIDファイルを書き込む。
 *
 * @param info - 登録するプロセス情報 / 登録対象のプロセス情報
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
 * PIDファイルを削除してプロセス追跡を解除する。
 *
 * @param pid - 解除対象のプロセスID / 対象プロセスID
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
 * 全PIDファイルを走査し、ゾンビプロセスをkillしてPIDファイルを削除する。
 * ポート3001をLISTENしているプロセスは保護する。
 *
 * @returns killしたプロセス数 / killしたプロセス数
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
          // プロセスは既に終了済み — PIDファイルだけ残っていた
          unlinkSync(filepath);
          logger.info(
            { pid: info.pid, role: info.role },
            '[ProcessTracker] Removed stale PID file',
          );
          continue;
        }

        // NOTE: ポート3001をLISTENしているプロセスはバックエンド本体の可能性があるため保護
        if (isListeningOnBackendPort(info.pid)) {
          logger.warn(
            { pid: info.pid },
            '[ProcessTracker] Skipping process — listening on port 3001 (backend protection)',
          );
          unlinkSync(filepath);
          continue;
        }

        // ゾンビプロセスをkill
        logger.info({ pid: info.pid, role: info.role }, '[ProcessTracker] Killing zombie process');
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${info.pid}`, { stdio: 'pipe', timeout: 5000 });
          } else {
            process.kill(info.pid, 'SIGKILL');
          }
          killedCount++;
        } catch (killError) {
          // kill失敗はプロセスが既に終了した可能性 — 致命的ではない
          logger.debug(
            { err: killError, pid: info.pid },
            '[ProcessTracker] Kill failed (process may have exited)',
          );
        }

        unlinkSync(filepath);
      } catch (fileError) {
        // 不正なPIDファイルは削除
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
 * PIDディレクトリ内の全ファイルを削除する（dev.js起動時クリーンアップ用）。
 * プロセスのkillは行わず、ファイルのみ削除する。
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
