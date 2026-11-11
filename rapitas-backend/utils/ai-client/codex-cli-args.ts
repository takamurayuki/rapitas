/**
 * codex-cli-args
 *
 * Builds what one auxiliary `codex exec` is launched with: the argv carrying
 * the routing2b §7-1 mitigations (and the ChatGPT-login pin), the sanitised
 * environment, the CLI path and the per-call timeout. Pure construction — no
 * spawning and no output reading (codex-cli-provider.ts / codex-cli-runner.ts).
 */
import { buildSanitizedSpawnEnv } from '../agent/sanitize-cli-env';
import { resolveCliPathAsync } from '../common/cli-path-resolver';
import { DEFAULT_CLI_TIMEOUT_MS, MAX_CLI_TIMEOUT_MS } from './claude-cli-timeouts';

/**
 * Features switched off for every auxiliary call. Passed with `-c`, which
 * ignores (with a warning item) a key an older/newer CLI does not know —
 * `--disable <name>` instead aborts with "Unknown feature flag".
 */
export const CODEX_AUX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'code_mode_host',
  'browser_use',
  'in_app_browser',
  'computer_use',
  'apps',
  'plugins',
  'hooks',
] as const;

/** Told to the model first; not enforceable, the flags above are the guard. */
export const CODEX_AUX_PREAMBLE =
  'You are answering as a text-only assistant. Do not run any commands, do not read or ' +
  'write any files, and do not use any tools. Base your answer only on the text below.';

/**
 * Resolve the Codex CLI binary (`CODEX_CLI_PATH`, else `codex` / `codex.cmd`).
 *
 * @returns Resolved CLI path / CLI のパス
 */
export function codexPath(): Promise<string> {
  const isWindows = process.platform === 'win32';
  return resolveCliPathAsync(process.env.CODEX_CLI_PATH || (isWindows ? 'codex.cmd' : 'codex'));
}

/** Base cap per call; `RAPITAS_AUX_AI_CODEX_TIMEOUT_MS`, else the Claude CLI's. */
function baseTimeoutMs(): number {
  const v = Number(process.env.RAPITAS_AUX_AI_CODEX_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CLI_TIMEOUT_MS;
}

/**
 * Same rule as resolveCliTimeoutMs: callers may only lengthen, up to the max.
 *
 * @param requestedMs - Caller's requested cap / 呼び出し側の希望上限
 * @returns Effective timeout in ms / 実際の上限（ミリ秒）
 */
export function resolveCodexTimeoutMs(requestedMs?: number): number {
  const base = baseTimeoutMs();
  if (typeof requestedMs !== 'number' || !Number.isFinite(requestedMs) || requestedMs <= base) {
    return base;
  }
  return Math.min(requestedMs, MAX_CLI_TIMEOUT_MS);
}

/**
 * Arguments for one auxiliary call.
 *
 * @param model - Model id for `-m` (the tier table's id) / モデルID
 * @param cwd - Empty working directory / 空の作業ディレクトリ
 * @returns argv for the Codex CLI / CLI の引数
 */
export function buildCodexAuxArgs(model: string | undefined, cwd: string): string[] {
  const effort = process.env.RAPITAS_AUX_AI_CODEX_EFFORT?.trim();
  return [
    '--ask-for-approval',
    'never',
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-C',
    cwd,
    ...CODEX_AUX_DISABLED_FEATURES.flatMap((f) => ['-c', `features.${f}=false`]),
    '-c',
    'web_search="disabled"',
    // Backstop for a login switched between the per-call check and this exec:
    // the CLI then refuses with "ChatGPT login is required" (verified on
    // 0.164.0-alpha.9). NOTE: it also logs the API key out of CODEX_HOME — only
    // reachable in that race, since the per-call check refuses first.
    '-c',
    'forced_login_method="chatgpt"',
    ...(effort && /^[a-z]+$/.test(effort) ? ['-c', `model_reasoning_effort="${effort}"`] : []),
    ...(model ? ['-m', model] : []),
    // Prompt on stdin: no shell quoting of the review text on any platform.
    '-',
  ];
}

/**
 * Spawn environment: secrets stripped, and the API key removed on purpose so
 * the CLI must use its ChatGPT login (owner decision 2026-11-11, mirroring the
 * Claude provider's ANTHROPIC_* removal). CODEX_HOME (the login) is kept.
 *
 * @returns Sanitised environment / サニタイズ済みの環境変数
 */
export function buildCodexAuxEnv(): NodeJS.ProcessEnv {
  const env = buildSanitizedSpawnEnv({ FORCE_COLOR: '0', NO_COLOR: '1', CI: '1', TERM: 'dumb' });
  // buildSanitizedSpawnEnv always keeps ANTHROPIC_* for the agent runners; the
  // Codex call needs none of it.
  for (const key of Object.keys(env)) {
    if (key.startsWith('ANTHROPIC_') || key === 'OPENAI_API_KEY' || key === 'CODEX_API_KEY') {
      delete env[key];
    }
  }
  if (process.platform === 'win32') {
    env.LANG = 'en_US.UTF-8';
    env.CHCP = '65001';
  }
  return env;
}
