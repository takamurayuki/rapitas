/**
 * Codex CLI Provider (ChatGPT-login-backed auxiliary calls)
 *
 * One-shot text generation through `codex exec`, for the review jury's seats
 * that sit on an OpenAI model (routing2b). Reached only through an explicit
 * `cliRoute: 'codex'` on sendAIMessage — never by provider name, so chat and
 * the other auxiliary features keep going to the Claude CLI. Not responsible
 * for agent/workflow execution (services/agents/codex-cli-agent).
 *
 * Mitigations for Codex having no "tools off" switch (routing2b recon §7-1):
 * secrets stripped from the environment (OPENAI_API_KEY too, so the call can
 * never bill the paid API), an empty per-call working directory, a read-only
 * sandbox, `--ignore-user-config` / `--ignore-rules`, the shell / exec /
 * browser / app features switched off with `-c features.*=false`, and a
 * prompt preamble telling the model not to run anything.
 *
 * NOTE: The provider is not re-exported from index.ts (many tests mock that
 * barrel with a fixed export list); index.ts imports it lazily.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../config/logger';
import { buildSanitizedSpawnEnv } from '../agent/sanitize-cli-env';
import { resolveCliPathAsync } from '../common/cli-path-resolver';
import { CodexCliUnavailableError } from './cli-errors';
import { parseCodexJsonl } from './codex-cli-events';
import { runCodexProcess } from './codex-cli-runner';
import { DEFAULT_CLI_TIMEOUT_MS, MAX_CLI_TIMEOUT_MS } from './claude-cli-timeouts';
import { guardPromptSize } from './prompt-size-guard';
import type { AIMessage, AIResponse } from './types';

const log = createLogger('ai-client:codex-cli');
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

function codexPath(): Promise<string> {
  const isWindows = process.platform === 'win32';
  return resolveCliPathAsync(process.env.CODEX_CLI_PATH || (isWindows ? 'codex.cmd' : 'codex'));
}

/** Base cap per call; `RAPITAS_AUX_AI_CODEX_TIMEOUT_MS`, else the Claude CLI's. */
function baseTimeoutMs(): number {
  const v = Number(process.env.RAPITAS_AUX_AI_CODEX_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CLI_TIMEOUT_MS;
}

/** Same rule as resolveCliTimeoutMs: callers may only lengthen, up to the max. */
function resolveCodexTimeoutMs(requestedMs?: number): number {
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

function combinePrompt(messages: AIMessage[], systemPrompt?: string): string {
  const system = systemPrompt || messages.find((m) => m.role === 'system')?.content || '';
  const convo = messages
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'assistant' ? `Assistant: ${m.content}` : m.content))
    .join('\n\n');
  return [CODEX_AUX_PREAMBLE, system, convo].filter(Boolean).join('\n\n');
}

// Separate pool from the Claude CLI's: the two are different subscriptions,
// so neither should queue behind the other.
const MAX_CONCURRENT = Number(process.env.RAPITAS_AUX_AI_CODEX_CONCURRENCY) || 2;
let activeCount = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot(): void {
  const next = queue.shift();
  if (next) next();
  else activeCount = Math.max(0, activeCount - 1);
}

/**
 * One-shot text generation via the Codex CLI on the ChatGPT login.
 *
 * @param model - Model id passed to `-m` (seats always pass one) / モデルID
 * @param messages - Conversation messages / 会話メッセージ
 * @param systemPrompt - Optional system instructions / システム指示（任意）
 * @param _maxTokens - Accepted for signature parity / 署名互換のため受理
 * @param timeoutMs - Optional longer cap for this call / この呼び出しの上限延長
 * @returns Final answer and token usage / 最終応答と使用量
 * @throws {CodexCliUnavailableError} When the CLI cannot serve the request / CLI が応答できない場合
 */
export async function callCodexCli(
  model: string | undefined,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  _maxTokens: number,
  timeoutMs?: number,
): Promise<AIResponse> {
  const prompt = guardPromptSize(combinePrompt(messages, systemPrompt));
  await acquireSlot();
  let cwd: string | null = null;
  try {
    cwd = await mkdtemp(join(tmpdir(), 'rapitas-codex-aux-'));
    const result = await runCodexProcess({
      codexPath: await codexPath(),
      args: buildCodexAuxArgs(model, cwd),
      cwd,
      env: buildCodexAuxEnv(),
      stdin: prompt,
      timeoutMs: resolveCodexTimeoutMs(timeoutMs),
    });
    const summary = parseCodexJsonl(result.stdout);
    if (result.code !== 0 || !summary.succeeded || summary.text === null) {
      const reason = (summary.failureMessage ?? result.stderr.trim()) || 'no output';
      throw new CodexCliUnavailableError(
        `Codex CLI ${result.code === 0 ? 'failed' : `exited ${result.code}`}: ${reason.slice(0, 300)}`,
      );
    }
    const usage = summary.usage;
    // OpenAI counts cached tokens inside input_tokens; the cost record follows
    // the Claude convention (input excludes cache reads), so split them.
    const cached = usage ? Math.min(usage.cachedInputTokens, usage.inputTokens) : 0;
    return {
      content: summary.text,
      tokensUsed: usage ? usage.inputTokens + usage.outputTokens : 0,
      ...(usage
        ? {
            inputTokens: usage.inputTokens - cached,
            outputTokens: usage.outputTokens,
            cacheReadInputTokens: cached,
          }
        : {}),
      // `--json` prints no `model:` header, so the requested id is the best
      // record available (the completion gate does not read this field).
      ...(model ? { modelName: model } : {}),
    };
  } finally {
    releaseSlot();
    if (cwd) {
      await rm(cwd, { recursive: true, force: true }).catch((err) =>
        log.warn({ err, cwd }, 'Codex aux working directory not removed'),
      );
    }
  }
}

/** Why the Codex CLI cannot sit, or 'ready'. */
export type CodexCliStatus = 'ready' | 'missing' | 'not_logged_in' | 'not_chatgpt_login';

/** Re-check a missing login after this long (matches the auth cooldown). */
const LOGIN_RECHECK_MS = 5 * 60_000;
let statusCache: { status: CodexCliStatus; until: number } | null = null;
let statusPending: Promise<CodexCliStatus> | null = null;

async function probeStatus(): Promise<CodexCliStatus> {
  const probe = async (args: string[]) => {
    const cwd = await mkdtemp(join(tmpdir(), 'rapitas-codex-probe-'));
    try {
      return await runCodexProcess({
        codexPath: await codexPath(),
        args,
        cwd,
        env: buildCodexAuxEnv(),
        stdin: '',
        timeoutMs: 10_000,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  };
  await acquireSlot();
  try {
    const version = await probe(['--version']).catch(() => null);
    if (!version || version.code !== 0) return 'missing';
    const login = await probe(['login', 'status']).catch(() => null);
    const text = login ? `${login.stdout}\n${login.stderr}` : '';
    if (!login || login.code !== 0 || /not logged in/i.test(text)) return 'not_logged_in';
    // An API-key login would bill the paid API, which the owner ruled out.
    return /chatgpt/i.test(text) ? 'ready' : 'not_chatgpt_login';
  } finally {
    releaseSlot();
  }
}

/**
 * Whether the Codex CLI runs and is logged in with ChatGPT. A found binary
 * is remembered for the process; a missing login is re-checked every 5 min.
 *
 * @returns The CLI's status / CLI の状態
 */
export async function getCodexCliStatus(): Promise<CodexCliStatus> {
  if (statusCache && statusCache.until > Date.now()) return statusCache.status;
  statusPending ??= probeStatus()
    .then((status) => {
      const keep = status === 'ready' || status === 'missing';
      statusCache = {
        status,
        until: keep ? Number.POSITIVE_INFINITY : Date.now() + LOGIN_RECHECK_MS,
      };
      return status;
    })
    .finally(() => {
      statusPending = null;
    });
  return statusPending;
}

/**
 * Whether the Codex CLI can take a jury seat right now.
 *
 * @returns true when installed and logged in with ChatGPT / 使えるなら true
 */
export async function isCodexCliAvailable(): Promise<boolean> {
  return (await getCodexCliStatus()) === 'ready';
}

/** Forget the memoised status. Test-only. */
export function __resetCodexCliStatusForTests(): void {
  statusCache = null;
  statusPending = null;
}
