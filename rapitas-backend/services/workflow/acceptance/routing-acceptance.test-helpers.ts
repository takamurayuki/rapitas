/**
 * routing-acceptance.test-helpers
 *
 * Test-only harness for acceptance test H (routing2b recon §6): one usage
 * pattern (Claude only / Codex only / both) is a configuration, and a task
 * goes "execute → verify → review → complete" through the PRODUCTION modules.
 * Boundaries cut here, and only here:
 * - vendors: the subscription CLI provider modules (callClaudeCli /
 *   callCodexCli and their availability probes) answer from a per-test
 *   script — sendAIMessage, cliRoute dispatch, jury seating, cooldowns and the
 *   two-seat jury are the real ones;
 * - model discovery: the per-provider probes report the pattern's models;
 * - git: the diff reader, the commit/PR side effect and worktree rebuild.
 * The run record is a real SQLite database built from the production init SQL.
 * Not responsible for assertions — the pattern files own those.
 *
 * NOTE: Call `installAcceptanceHarness()` before importing anything from the
 * pipeline: bun's mock.module only affects modules loaded after it.
 */
import { mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../../src/generated/sqlite-init-sql';
import { ClaudeCliUnavailableError } from '../../../utils/ai-client/cli-errors';
import type { AIMessage } from '../../../utils/ai-client/types';
import type { DiscoveredModel, Provider } from '../../ai/model-discovery/types';

/** Which jury seat a prompt was written for; 'other' = any other aux feature. */
export type CallSeat = 'reviewer' | 'verifier' | 'other';

/** One call that reached a subscription CLI. */
export interface CliCall {
  route: 'claude' | 'codex';
  model: string | undefined;
  seat: CallSeat;
  prompt: string;
}

/**
 * Classify a prompt by the jury's own prompt builders' opening lines
 * (buildDiffReviewPrompt / buildVerifierPrompt).
 *
 * @param prompt - Prompt text / プロンプト
 * @returns The seat kind / 席の種類
 */
export function seatOfPrompt(prompt: string): CallSeat {
  if (prompt.includes('あなたはシニアコードレビュアーです')) return 'reviewer';
  if (prompt.includes('あなたは検証担当です')) return 'verifier';
  return 'other';
}

/**
 * The calls the jury made, as [route, model, seat].
 *
 * @param state - Harness state / ハーネスの状態
 * @returns Jury calls only / 陪審の呼び出しだけ
 */
export function juryCalls(state: AcceptanceState): Array<[string, string | undefined, CallSeat]> {
  return state.calls.filter((c) => c.seat !== 'other').map((c) => [c.route, c.model, c.seat]);
}

/** Per-test configuration of the host and the vendors' answers. */
export interface AcceptanceState {
  claudeCli: boolean;
  codexCli: boolean;
  /** Models the discovery probes report, per provider. */
  discovered: Record<'claude' | 'openai', string[]>;
  /** Answer for one CLI call: text, or an error the provider throws. */
  reply: (call: CliCall) => string | Error;
  calls: CliCall[];
  /** performAutoCommitAndPR invocations (the commit/PR side effect). */
  commits: number[];
  /**
   * Decision traces as recorded. The recorder itself skips writes under
   * NODE_ENV=test, so its input is captured here instead of from the table.
   */
  decisions: Array<{
    taskId?: number;
    summary: string;
    adoptedReason?: string;
    input?: Record<string, unknown>;
  }>;
}

/** Juror answers in the shape parseReviewVerdict reads. */
export const PASS = '{"verdict":"pass","severity":0,"findings":[]}';
export const FAIL = (summary: string) =>
  JSON.stringify({
    verdict: 'fail',
    severity: 90,
    findings: [{ severity: 'major', summary, evidence: 'src/a.ts:1' }],
  });
/** Verifier answer for the single disputed finding. */
export const VERIFY = (status: 'holds' | 'refuted' | 'undetermined') =>
  JSON.stringify({ results: [{ index: 1, status, note: 'src/a.ts:1 を確認' }] });

/**
 * A reply script: reviewer answers in seat order (reviewer-1 first), the
 * verifier's answer, and what other aux features get (default: empty text).
 *
 * @param p.reviewers - Reviewer answers in call order / レビュー席の答え（呼び出し順）
 * @param p.verifier - Verifier answer / 検証席の答え
 * @param p.other - Answer for non-jury aux calls / 陪審以外の補助呼び出しの答え
 * @returns A reply function / 応答関数
 */
export function script(p: {
  reviewers?: Array<string | Error>;
  verifier?: string | Error;
  other?: string | Error;
}): AcceptanceState['reply'] {
  let reviewerIndex = 0;
  return (call) => {
    if (call.seat === 'reviewer') return p.reviewers?.[reviewerIndex++] ?? PASS;
    if (call.seat === 'verifier') return p.verifier ?? VERIFY('refuted');
    return p.other ?? '';
  };
}

const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };

/**
 * Create the database and install every boundary mock.
 *
 * @param state - Mutable per-test configuration / テストごとの構成
 * @returns The SQLite Prisma client and a cleanup / DB とその後始末
 */
export function installAcceptanceHarness(state: AcceptanceState): {
  db: PrismaClient;
  dispose: () => Promise<void>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'rapitas-acceptance-'));
  const dbPath = join(dir, 'test.db');
  const init = new Database(dbPath);
  init.exec(SQLITE_INIT_SQL);
  init.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  process.env.RAPITAS_DB_PROVIDER = 'sqlite';
  process.env.RAPITAS_AUX_AI = 'cli';
  process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS = '5000';

  mock.module('../../../config/database', () => ({
    prisma: db,
    ensureDatabaseConnection: async () => {},
  }));
  mock.module('../../../config/logger', () => ({
    createLogger: () => logger,
    logger,
    getBackendLogFilePath: () => join(dir, 'backend.log'),
  }));

  const answer = (route: CliCall['route'], model: string | undefined, prompt: string) => {
    const call: CliCall = { route, model, prompt, seat: seatOfPrompt(prompt) };
    state.calls.push(call);
    const out = state.reply(call);
    if (out instanceof Error) throw out;
    return { content: out, tokensUsed: 10, inputTokens: 6, outputTokens: 4, modelName: model };
  };
  const promptOf = (messages: AIMessage[]) => messages.map((m) => m.content).join('\n');
  mock.module('../../../utils/ai-client/claude-cli-provider', () => ({
    callClaudeCli: async (model: string | undefined, messages: AIMessage[]) =>
      answer('claude', model, promptOf(messages)),
    callClaudeCliStream: async () => new ReadableStream(),
    isClaudeCliAvailable: async () => state.claudeCli,
    ClaudeCliUnavailableError,
    buildSpawnCommand: (p: string, a: string[]) => [p, a],
    DEFAULT_CLI_TIMEOUT_MS: 120_000,
    MAX_CLI_TIMEOUT_MS: 600_000,
    resolveCliTimeoutMs: () => 120_000,
  }));
  mock.module('../../../utils/ai-client/codex-cli-provider', () => ({
    callCodexCli: async (model: string | undefined, messages: AIMessage[]) =>
      answer('codex', model, promptOf(messages)),
    getCodexCliStatus: async () => (state.codexCli ? 'ready' : 'missing'),
    isCodexCliAvailable: async () => state.codexCli,
    buildCodexAuxArgs: () => [],
    buildCodexAuxEnv: () => ({}),
    CODEX_AUX_DISABLED_FEATURES: [],
    CODEX_AUX_PREAMBLE: '',
    __resetCodexCliStatusForTests: noop,
  }));

  mock.module('../../observability/decision-trace/recorder', () => ({
    recordDecision: async (input: AcceptanceState['decisions'][number]) => {
      state.decisions.push(input);
    },
  }));

  const probe = (provider: Provider) => async () => {
    const { classifyTier, inferCostPer1k } =
      await import('../../ai/model-discovery/tier-classifier');
    const ids = provider === 'claude' || provider === 'openai' ? state.discovered[provider] : [];
    const models: DiscoveredModel[] = ids.map((id) => {
      const tier = classifyTier(id);
      return { id, provider, tier, costPer1kTokens: inferCostPer1k(id, tier), source: 'cli-alias' };
    });
    return { provider, available: models.length > 0, models };
  };
  mock.module('../../ai/model-discovery/probes/claude-probe', () => ({
    probeClaude: probe('claude'),
  }));
  mock.module('../../ai/model-discovery/probes/openai-probe', () => ({
    probeOpenAi: probe('openai'),
  }));
  mock.module('../../ai/model-discovery/probes/gemini-probe', () => ({
    probeGemini: probe('gemini'),
  }));
  mock.module('../../ai/model-discovery/probes/ollama-probe', () => ({
    probeOllama: probe('ollama'),
  }));

  mock.module('../../agents/orchestrator/git-operations/core/diff-structured', () => ({
    getDiff: async () => [
      {
        filename: 'src/a.ts',
        status: 'M',
        additions: 3,
        deletions: 1,
        patch: '+export const a = 1;',
      },
    ],
    resolveBaseRef: async () => 'origin/develop',
  }));
  mock.module('../worktree-rebuild-recovery', () => ({
    WORKTREE_REBUILD_CAUSE: 'worktree_rebuilt',
    attemptWorktreeRebuildRecovery: async () => ({ recovered: false, reason: 'not_applicable' }),
    tryRecoverFromHistoryContamination: async () => ({
      recovered: false,
      reason: 'not_applicable',
    }),
    notifyRecoveryFallbackBlocked: async () => {},
  }));

  return {
    db,
    dispose: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Mock the commit/PR side effect: a commit, no PR requested (landing mode
 * `commit`), so completion is reached without git or GitHub.
 *
 * NOTE: Kept separate because the module path is under routes/, which a
 * services helper must not import statically (import-graph rule).
 *
 * @param state - Records the call / 呼び出しの記録先
 * @param classify - The real no-change classifier, mirrored / 実物の分類関数
 */
export function mockCommitSideEffect(
  state: AcceptanceState,
  classify: { isNoChangeCompletion: unknown; countCommitsAhead: unknown },
): void {
  mock.module('../../../routes/workflow/workflow-auto-commit', () => ({
    ...classify,
    performAutoCommitAndPR: async (taskId: number) => {
      state.commits.push(taskId);
      return {
        requested: { autoCommit: true, autoCreatePR: false, autoMergePR: false },
        autoCommitResult: { success: true, hash: 'abc1234', branch: `feature/t${taskId}` },
      };
    },
  }));
}

/** A fresh, empty per-test state. */
export function freshState(over: Partial<AcceptanceState> = {}): AcceptanceState {
  return {
    claudeCli: true,
    codexCli: false,
    discovered: { claude: [], openai: [] },
    reply: script({}),
    calls: [],
    commits: [],
    decisions: [],
    ...over,
  };
}
