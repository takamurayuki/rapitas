/**
 * claude-spawn-env
 *
 * Builds the environment for the Claude Code CLI subprocess and streams the
 * prompt to its stdin. Split out of claude-execution-runner.ts to keep that
 * file under the 300-line threshold; not responsible for spawning.
 */
import { buildSanitizedSpawnEnv } from '../../../utils/agent';
import { createLogger } from '../../../config/logger';
import { writePromptChunks } from './stdin-prompt-writer';
import type { ClaudeCodeAgent } from './agent-core';

const logger = createLogger('claude-code-agent');

/**
 * Build the env passed to the Claude Code CLI subprocess.
 *
 * @returns Sanitized environment (see buildSanitizedSpawnEnv) plus CLI-friendly overrides / サニタイズ済み環境
 */
export function buildSpawnEnv(): NodeJS.ProcessEnv {
  const isWindows = process.platform === 'win32';
  // NOTE: Heap cap for EVERY node process in the agent's tree (NODE_OPTIONS is
  // inherited by child processes, so `next build` etc. get it too). Task 553:
  // an agent-run webpack build with splitChunks.maxSize grew to 48 GB RSS and
  // starved the host (1.9 GB free of 64 GB) — an explicit OOM failure the agent
  // can see and self-repair beats a silent host-wide stall. 8192 MB is generous:
  // CI runners build this frontend within ~7 GB total RAM.
  const heapMb = Math.max(
    1024,
    parseInt(process.env.RAPITAS_AGENT_NODE_HEAP_MB ?? '8192', 10) || 8192,
  );
  // NOTE: The spawned CLI is prompt-steerable (the task prompt itself can ask
  // it to print/exfiltrate its own env), so start from a sanitized base —
  // never the raw inherited env — to keep ENCRYPTION_KEY/DATABASE_URL/
  // GITHUB_TOKEN/etc out of its reach.
  return buildSanitizedSpawnEnv({
    // NOTE: Task 1582 — turns off Bash run_in_background. Under `--print` a
    // background job's completion never reaches the agent, which then ends its
    // turn "waiting" and the run is recorded as finished. Overrides are applied
    // last by buildSanitizedSpawnEnv, so an inherited value cannot re-enable it.
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CI: '1',
    TERM: 'dumb',
    PYTHONUNBUFFERED: '1',
    NODE_OPTIONS: `--no-warnings --max-old-space-size=${heapMb}`,
    ...(isWindows && {
      LANG: 'en_US.UTF-8',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      CHCP: '65001', // Enable UTF-8 mode on Windows 10+
    }),
  });
}

/**
 * Stream the prompt to stdin in 16 KB chunks (avoids buffering issues).
 *
 * @param agent - Agent whose child process receives the prompt / プロンプトを受け取るエージェント
 * @param prompt - Full prompt text / プロンプト本文
 */
export async function writePromptToStdin(agent: ClaudeCodeAgent, prompt: string): Promise<void> {
  if (!agent.process?.stdin) {
    logger.info(`${agent.logPrefix} stdin is not available`);
    return;
  }
  const { bytes, completed } = await writePromptChunks(
    agent.process.stdin,
    prompt,
    (err, closed) => {
      // NOTE: EPIPE means the CLI exited before reading the prompt; the close handler reports the real cause.
      if (closed)
        logger.warn(
          `${agent.logPrefix} stdin closed by CLI before prompt was fully written (${err.message})`,
        );
      else logger.error({ err }, `${agent.logPrefix} stdin error`);
    },
  );
  logger.info(
    `${agent.logPrefix} Prompt ${completed ? 'written to stdin' : 'write aborted'} (${bytes} bytes)`,
  );
}
