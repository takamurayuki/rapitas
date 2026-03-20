/**
 * SpawnConfig
 *
 * Builds the command, argument list, and environment variables needed to
 * spawn the Claude CLI subprocess. Isolated here so process-manager.ts
 * focuses on lifecycle management rather than CLI flag construction.
 */
import type { AgentTask } from '../../agents/base-agent';
import { createLogger } from '../../../config/logger';

const logger = createLogger('sub-agent-controller');

/** Resolved command and args ready for Node.js spawn(). */
export type SpawnSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

/**
 * Build the spawn specification for the Claude CLI.
 *
 * On Windows: wraps everything in a `chcp 65001 && …` cmd invocation so
 * stdout is UTF-8. On other platforms: calls claude directly.
 *
 * @param agentId - Agent ID for log messages / ログ用エージェントID
 * @param task - Task being executed / 実行中のタスク
 * @param dangerouslySkipPermissions - Pass --dangerously-skip-permissions flag / パーミッションスキップフラグ
 * @returns Resolved spawn specification / スポーン仕様
 */
export function buildSpawnSpec(
  agentId: string,
  task: AgentTask,
  dangerouslySkipPermissions: boolean,
): SpawnSpec {
  const isWindows = process.platform === 'win32';
  const claudePath = process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude');

  const args: string[] = [];
  args.push('--print');
  args.push('--verbose');
  args.push('--output-format', 'stream-json');

  if (task.resumeSessionId) {
    args.push('--continue');
    logger.info(`[SubAgent ${agentId}] Continuing session: ${task.resumeSessionId}`);
  }

  if (dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  // NOTE: Disable worktree tools to prevent the spawned CLI from creating nested worktrees
  // that conflict with rapitas-managed worktrees and could corrupt .git/ directory structure.
  args.push('--disallowedTools', 'EnterWorktree,ExitWorktree');

  // NOTE: Model selection — use task-specific model or fall back to default
  const modelId = (task as Record<string, unknown>).modelId as string | undefined;
  if (modelId) {
    args.push('--model', modelId);
    logger.info(`[SubAgent ${agentId}] Using model: ${modelId}`);
  }

  let finalCommand: string;
  let finalArgs: string[];

  if (isWindows) {
    // NOTE: chcp 65001 sets UTF-8 code page before running claude on Windows
    const argsString = args
      .map((arg) => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
          return `"${arg}"`;
        }
        return arg;
      })
      .join(' ');
    finalCommand = `chcp 65001 >NUL 2>&1 && ${claudePath} ${argsString}`;
    finalArgs = [];
  } else {
    finalCommand = claudePath;
    finalArgs = args;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CI: '1',
    TERM: 'dumb',
    PYTHONUNBUFFERED: '1',
    NODE_OPTIONS: '--no-warnings',
    ...(isWindows && {
      LANG: 'en_US.UTF-8',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      CHCP: '65001',
    }),
  };

  return { command: finalCommand, args: finalArgs, env };
}
