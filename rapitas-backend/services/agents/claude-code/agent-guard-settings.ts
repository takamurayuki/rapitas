/**
 * agent-guard-settings
 *
 * Writes the settings file that explicitly injects the primary-checkout PreToolUse
 * hook into spawned Claude CLI runs (--settings). Not responsible for the hook's
 * decision logic (see scripts/primary-guard-hook.cjs).
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLogger } from '../../../config/logger';

const log = createLogger('agents:agent-guard-settings');

// NOTE: rapitas-backend/services/agents/claude-code → repo root is four levels up. The hook is
// resolved from the running backend's checkout so worktrees branched before the hook existed
// (no scripts/primary-guard-hook.cjs of their own) are still covered.
const HOOK_SCRIPT = resolve(import.meta.dir, '../../../../scripts/primary-guard-hook.cjs');

const STALE_RUN_MS = 24 * 60 * 60 * 1000;

/** Backend-owned directory; same RAPITAS_DATA_DIR rule as cycle-event-logger. */
function guardRootDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'agent-guard');
}

/** Best-effort removal of per-run directories older than 24h; never throws. */
function pruneStaleRuns(root: string): void {
  try {
    const cutoff = Date.now() - STALE_RUN_MS;
    for (const name of readdirSync(root)) {
      if (!name.startsWith('run-')) continue;
      const dir = join(root, name);
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore — another run may be racing us */
      }
    }
  } catch {
    /* ignore */
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Read the file back and compare its sha256 with the expected content's.
 *
 * @param file - Path that was written / 書き込んだファイル
 * @param expected - Content that should be on disk / 期待する内容
 * @returns true only when the on-disk hash matches; false on mismatch or read error / ハッシュ一致時のみ true
 */
export function verifyGuardSettingsFile(file: string, expected: string): boolean {
  try {
    return sha256(readFileSync(file, 'utf8')) === sha256(expected);
  } catch {
    return false;
  }
}

/**
 * Create a fresh, hash-verified guard settings file and return its path.
 *
 * @returns Absolute settings path, or null when the hook script is unavailable or the file
 *   could not be created/verified (caller falls back to project settings) / 設定ファイルのパス（失敗時は null）
 */
export function ensureGuardSettingsFile(): string | null {
  if (!existsSync(HOOK_SCRIPT)) {
    log.warn(
      { hook: HOOK_SCRIPT },
      'Primary guard hook script missing; guard settings not injected',
    );
    return null;
  }
  try {
    const root = guardRootDir();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    pruneStaleRuns(root);
    // mkdtemp gives a random, exclusively-created directory: no predictable path to pre-plant.
    const dir = mkdtempSync(join(root, 'run-'));
    const file = join(dir, 'settings.json');
    const content = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|PowerShell',
            hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT}"`, timeout: 5 }],
          },
        ],
      },
    });
    writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
    if (!verifyGuardSettingsFile(file, content)) {
      log.warn({ file }, 'Guard settings hash mismatch after write; refusing to use it');
      return null;
    }
    return file;
  } catch (err) {
    log.warn({ err }, 'Failed to create guard settings file; falling back to project settings');
    return null;
  }
}
