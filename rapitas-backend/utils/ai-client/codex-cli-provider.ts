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
 * ChatGPT-only (owner decision 1) is enforced on EVERY call, not just at the
 * availability probe: `codex login status` is re-read right before `exec`,
 * and `exec` is pinned with `forced_login_method="chatgpt"` (routing2b G2
 * finding 1 — a CODEX_HOME switched to an API key after the first probe).
 *
 * NOTE: The argv / env builders live in codex-cli-args.ts and are re-exported
 * here, so existing importers and mocks of this module keep working.
 *
 * NOTE: The provider is not re-exported from index.ts (many tests mock that
 * barrel with a fixed export list); index.ts imports it lazily.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../config/logger';
import { CodexCliUnavailableError } from './cli-errors';
import {
  buildCodexAuxArgs,
  buildCodexAuxEnv,
  CODEX_AUX_PREAMBLE,
  codexPath,
  resolveCodexTimeoutMs,
} from './codex-cli-args';
import { describeCodexFailure, parseCodexJsonl } from './codex-cli-events';
import { runCodexProcess } from './codex-cli-runner';
import { guardPromptSize } from './prompt-size-guard';
import type { AIMessage, AIResponse } from './types';

export {
  buildCodexAuxArgs,
  buildCodexAuxEnv,
  CODEX_AUX_DISABLED_FEATURES,
  CODEX_AUX_PREAMBLE,
} from './codex-cli-args';

const log = createLogger('ai-client:codex-cli');

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
    await assertChatgptLogin();
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
      const reason = describeCodexFailure(summary, result.stderr);
      // The tail is kept: a quota line ends with the "try again at" time.
      const shown = reason.length > 300 ? `…${reason.slice(-300)}` : reason;
      throw new CodexCliUnavailableError(
        `Codex CLI ${result.code === 0 ? 'failed' : `exited ${result.code}`}: ${shown}`,
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

/** Runs a short CLI query. The caller must already hold a slot. */
async function probe(args: string[]) {
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
}

/** `codex login status` read fresh; never 'missing' (the binary ran or not). */
async function readLoginStatus(): Promise<Exclude<CodexCliStatus, 'missing'>> {
  const login = await probe(['login', 'status']).catch(() => null);
  const text = login ? `${login.stdout}\n${login.stderr}` : '';
  if (!login || login.code !== 0 || /not logged in/i.test(text)) return 'not_logged_in';
  // An API-key login would bill the paid API, which the owner ruled out.
  return /chatgpt/i.test(text) ? 'ready' : 'not_chatgpt_login';
}

/**
 * Refuse the call unless CODEX_HOME is on a ChatGPT login right now. A refusal
 * also replaces the memoised 'ready', so seat planning stops offering the
 * Codex seat without waiting for a restart. The message contains "not logged
 * in" on purpose: the classifier reads it as auth, so the juror cooldown
 * (juror-cli-cooldown.ts) cools openai.
 */
async function assertChatgptLogin(): Promise<void> {
  const status = await readLoginStatus();
  if (status === 'ready') return;
  statusCache = { status, until: Date.now() + LOGIN_RECHECK_MS };
  throw new CodexCliUnavailableError(
    status === 'not_chatgpt_login'
      ? 'Codex CLI not logged in with ChatGPT (an API-key login is configured); refused'
      : 'Codex CLI not logged in with ChatGPT (no login); refused',
  );
}

async function probeStatus(): Promise<CodexCliStatus> {
  await acquireSlot();
  try {
    const version = await probe(['--version']).catch(() => null);
    if (!version || version.code !== 0) return 'missing';
    return await readLoginStatus();
  } finally {
    releaseSlot();
  }
}

/**
 * Whether the Codex CLI runs and is logged in with ChatGPT. A found binary
 * is remembered for the process; a missing login is re-checked every 5 min.
 * A remembered 'ready' is only a seating hint — every call re-checks the
 * login and downgrades this status when it changed.
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
