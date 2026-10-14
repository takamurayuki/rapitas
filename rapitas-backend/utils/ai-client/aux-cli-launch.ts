/** Platform admission boundary for auxiliary CLI containment. */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createOwnershipRegistry } from './aux-cli-ownership';
import { createWindowsAuxExecutionManager } from './windows-aux-execution';
import { createLinuxAuxExecutionManager } from './linux-aux-execution';
import { ClaudeCliUnavailableError } from './cli-errors';

let windowsManager: ReturnType<typeof createWindowsAuxExecutionManager> | undefined;
let linuxManager: ReturnType<typeof createLinuxAuxExecutionManager> | undefined;

/**
 * The deadline both launchers already read from their own environment.
 *
 * Windows: `windows-aux-job.ps1` parses it as `[uint32]`.
 * Linux: `linux-aux-launcher.ts` reads it for its `setTimeout`.
 */
export const LAUNCHER_TIMEOUT_ENV = 'RAPITAS_AUX_AI_CLI_TIMEOUT_MS';

/** Highest value `[uint32]::Parse` accepts; above it the ps1 throws and exits 1. */
const MAX_LAUNCHER_TIMEOUT_MS = 4_294_967_295;

/**
 * Put a per-call launcher deadline into the environment handed to the launcher.
 *
 * NOTE: until this existed, the launchers' deadline came only from the backend
 * process environment, so a caller asking for a longer `timeoutMs` (e.g. the
 * 600s document generation) still had its CLI killed at the 120s default and
 * surfaced as `Claude CLI exited 124: Auxiliary CLI launcher deadline exceeded`.
 *
 * @param env - Environment for the launcher process / ランチャーに渡す環境変数
 * @param timeoutMs - The caller's resolved deadline, if any / 呼び出し側の期限
 * @returns A copy carrying the deadline, or `env` unchanged / 期限付きのコピー
 */
export function launcherEnv(env: NodeJS.ProcessEnv, timeoutMs?: number): NodeJS.ProcessEnv {
  // A non-integer or out-of-range value would make the ps1's uint32 parse throw,
  // turning a bad hint into a hard launch failure — fall back to the default.
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    Math.round(timeoutMs) > MAX_LAUNCHER_TIMEOUT_MS
  )
    return env;
  return { ...env, [LAUNCHER_TIMEOUT_ENV]: String(Math.round(timeoutMs)) };
}

export async function prepareAuxCli(
  command: string,
  directory: string,
  env: NodeJS.ProcessEnv,
  args: string[] = [],
  timeoutMs?: number,
) {
  const launchEnv = launcherEnv(env, timeoutMs);
  if (process.platform === 'linux') {
    linuxManager ??= createLinuxAuxExecutionManager(
      createOwnershipRegistry(
        join(
          process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas'),
          'aux-cli-ownership.json',
        ),
      ),
    );
    return linuxManager.reserve(command, args, directory, launchEnv);
  }
  if (process.platform !== 'win32')
    // NOTE(task #914): classify as ClaudeCliUnavailableError so callers (e.g.
    // pre-pr-base-sync.ts) that match on err.name still fail open correctly.
    throw new ClaudeCliUnavailableError(
      `Owned auxiliary CLI launch is unavailable on ${process.platform}`,
    );
  windowsManager ??= createWindowsAuxExecutionManager(
    createOwnershipRegistry(
      join(
        process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas'),
        'aux-cli-ownership.json',
      ),
    ),
  );
  const shell = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  return windowsManager.reserve(`"${shell}" /d /s /c "${command}"`, directory, launchEnv);
}
