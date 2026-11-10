/**
 * session-cost-totals
 *
 * Recomputes an AgentSession's totalCostUsd / totalTokensUsed from the usage
 * actually recorded for it: its AgentExecution rows (attributed as increments
 * by execution-cost-attribution.ts) plus the tokens of its AgentAction rows
 * (non-execution LLM calls such as task analysis and prompt optimisation).
 * Not responsible for writing execution or action rows.
 *
 * Why recompute instead of increment: an execution row's costUsd and
 * tokensUsed hold the Claude CLI's SESSION-cumulative totals. Incrementing the
 * session by each saved value counted every resume's history again (a
 * `--resume` reporting 0.00456 after a 0.00257 run added 0.00713 for a session
 * that cost 0.00456), so the session total drifted above real spend.
 *
 * Three properties the recompute must keep (G2 review items 5–7):
 * - Attribution scope matches execution-cost-attribution's callers that pass
 *   ALL rows: a CLI session (`claudeSessionId`) resumed under a NEW
 *   AgentSession continues the chain from the other AgentSession's rows, so
 *   this session is charged only its increment.
 * - Every absolute write is verified against a re-read of the usage rows and
 *   repeated (in-line, then by a deferred retry) until they agree, so a
 *   recompute that read an older row set can never leave an older total
 *   behind (re-review items 1 and 4; see recomputeInline). A recompute that
 *   throws is retried the same way; the restart gap of the in-memory retry is
 *   closed by session-cost-recovery.ts.
 * - Usage recorded outside AgentExecution (AgentAction.tokensUsed) is part of
 *   the total, so a later recompute does not erase it.
 */
import { attributeIncrementalCosts } from './execution-cost-attribution';
import { createLogger } from '../../config/logger';
import { createKeyedRetryQueue } from './keyed-retry-queue';

const log = createLogger('agents:session-cost-totals');

/** Write-then-verify rounds done in-line before handing over to the deferred retry. */
const MAX_INLINE_ATTEMPTS = 5;
/** Backoff of the deferred retry (doubles per retry, capped). */
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 30_000;

/** One execution row as the recompute reads it. */
export interface SessionCostRow {
  id?: number;
  sessionId?: number;
  costUsd: unknown;
  tokensUsed: number | null;
  claudeSessionId: string | null;
  startedAt: Date | null;
}

const ROW_SELECT = {
  id: true,
  sessionId: true,
  costUsd: true,
  tokensUsed: true,
  claudeSessionId: true,
  startedAt: true,
} as const;

/** The Prisma delegates this needs (structural, so tests can pass fakes). */
export interface SessionTotalsDb {
  agentExecution: {
    findMany(args: {
      where: { sessionId: number } | { claudeSessionId: { in: string[] } };
      select: typeof ROW_SELECT;
    }): Promise<SessionCostRow[]>;
  };
  agentAction: {
    findMany(args: {
      where: { sessionId: number };
      select: { tokensUsed: true };
    }): Promise<Array<{ tokensUsed: number | null }>>;
  };
  agentSession: {
    updateMany(args: {
      where: { id: number };
      data: { totalCostUsd: number; totalTokensUsed: number };
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: number };
      data: { totalLlmCallCount?: { increment: number }; lastActivityAt: Date };
    }): Promise<unknown>;
  };
}

/**
 * Pure: session totals implied by execution rows (+ non-execution tokens).
 *
 * @param rows - Execution rows; may include other sessions' rows of the same CLI chains / 実行行（同じCLIセッションの他セッション行を含みうる）
 * @param opts.sessionId - Only rows of this session are charged; others only give the chain's starting point / 計上対象のセッション
 * @param opts.extraTokens - Tokens recorded outside AgentExecution / 実行行以外のトークン
 * @returns Attributed cost and token totals / 増分で合算した費用とトークン
 */
export function sessionTotalsFromRows(
  rows: ReadonlyArray<SessionCostRow>,
  opts: { sessionId?: number; extraTokens?: number } = {},
): { totalCostUsd: number; totalTokensUsed: number } {
  const charged = (r: SessionCostRow) => opts.sessionId == null || r.sessionId === opts.sessionId;
  const costInc = attributeIncrementalCosts(rows);
  // tokensUsed is cumulative per CLI session exactly like costUsd (#1302), so
  // the same increment walk applies.
  const tokenInc = attributeIncrementalCosts(
    rows.map((r) => ({
      costUsd: r.tokensUsed ?? 0,
      claudeSessionId: r.claudeSessionId,
      startedAt: r.startedAt,
    })),
  );
  let cost = 0;
  let tokens = opts.extraTokens ?? 0;
  rows.forEach((r, i) => {
    if (!charged(r)) return;
    cost += costInc[i];
    tokens += tokenInc[i];
  });
  return { totalCostUsd: Math.round(cost * 1e6) / 1e6, totalTokensUsed: Math.round(tokens) };
}

/**
 * Read everything the session's totals depend on: its own rows, every row of
 * the CLI chains they belong to (any AgentSession), and its action tokens.
 */
async function readUsage(
  db: SessionTotalsDb,
  sessionId: number,
): Promise<{ rows: SessionCostRow[]; extraTokens: number }> {
  const own = await db.agentExecution.findMany({ where: { sessionId }, select: ROW_SELECT });
  const chainIds = [...new Set(own.map((r) => r.claudeSessionId).filter((c): c is string => !!c))];
  const chained =
    chainIds.length > 0
      ? await db.agentExecution.findMany({
          where: { claudeSessionId: { in: chainIds } },
          select: ROW_SELECT,
        })
      : [];
  const byId = new Map<number | string, SessionCostRow>();
  // Own rows are charged by construction (tagged even if a reader omits the column).
  own.forEach((r, i) => byId.set(r.id ?? `own-${i}`, { ...r, sessionId }));
  for (const r of chained) if (r.id != null && !byId.has(r.id)) byId.set(r.id, r);
  const actions = await db.agentAction.findMany({
    where: { sessionId },
    select: { tokensUsed: true },
  });
  const extraTokens = actions.reduce((a, b) => a + (b.tokensUsed ?? 0), 0);
  return { rows: [...byId.values()], extraTokens };
}

type Totals = { totalCostUsd: number; totalTokensUsed: number };

/**
 * Totals the session's CURRENT usage rows imply (read only; nothing written).
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param sessionId - Session to read / 対象セッション
 * @returns Attributed cost and token totals / 利用行から求めた費用とトークン
 */
export async function readTotals(db: SessionTotalsDb, sessionId: number): Promise<Totals> {
  const { rows, extraTokens } = await readUsage(db, sessionId);
  return sessionTotalsFromRows(rows, { sessionId, extraTokens });
}

const sameTotals = (a: Totals, b: Totals) =>
  a.totalCostUsd === b.totalCostUsd && a.totalTokensUsed === b.totalTokensUsed;

type InlineResult = 'converged' | 'missing' | 'contended';

/**
 * Write the totals, then re-read the usage they were built from; repeat until
 * what was written is what the current rows imply.
 *
 * Why no version/CAS: totals are a pure function of the usage rows, so the
 * rows themselves are the only version that matters, and an "ABA" of the rows
 * is harmless (identical rows ⇒ identical, correct totals). The previous CAS
 * compared `lastActivityAt`, which eight other paths overwrite with
 * `new Date()` — within one millisecond that restored the compared value and
 * let a stale 1.0 replace a newer 1.5 (G2 re-review item 1). A dedicated
 * version column would need a schema change (prisma generate + server
 * restart, forbidden from an agent run by CLAUDE.md §1).
 *
 * Correctness: the LAST write to the totals is always followed by its
 * writer's verification read; any usage row added after that read triggers
 * its own recompute, whose write would come later — so the final value
 * matches the final rows, provided no writer stops before its write was
 * verified. Writers that run out of in-line attempts therefore never stop:
 * they hand over to the deferred retry below (re-review item 4).
 */
async function recomputeInline(db: SessionTotalsDb, sessionId: number): Promise<InlineResult> {
  let totals = await readTotals(db, sessionId);
  for (let attempt = 0; attempt < MAX_INLINE_ATTEMPTS; attempt++) {
    const res = await db.agentSession.updateMany({ where: { id: sessionId }, data: totals });
    if (res.count === 0) return 'missing';
    const current = await readTotals(db, sessionId);
    if (sameTotals(current, totals)) return 'converged';
    totals = current;
  }
  return 'contended';
}

const retries = createKeyedRetryQueue<number>({
  baseMs: RETRY_BASE_MS,
  maxMs: RETRY_MAX_MS,
  onStillPending: (sessionId, n) =>
    log.warn({ sessionId, retries: n }, '[session-cost] Totals still unverified'),
  onError: (sessionId, err) =>
    log.warn({ err, sessionId }, '[session-cost] Deferred recompute failed; retrying'),
});

/**
 * Hand a session to the deferred, verified recompute without trying in-line
 * first — for callers whose own read of the session failed and that must not
 * leave it unrepaired (startup recovery, the background sweep).
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param sessionId - Session to recompute later / 後で再計算するセッション
 */
export function scheduleSessionRecompute(db: SessionTotalsDb, sessionId: number): void {
  // Coalesced per session: the retry re-reads every row.
  retries.schedule(sessionId, async () => (await recomputeInline(db, sessionId)) === 'contended');
}

/**
 * Rewrite a session's cost/token totals from its recorded usage, verified
 * against a re-read of it (recomputeInline). If writers keep changing the
 * rows past the in-line attempts, the session stays pending and is retried
 * with backoff until verified — never left to "the next recompute".
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param sessionId - Session to recompute / 再計算するセッション
 * @returns True when the totals were written and verified in-line; false when the session is missing or the verification was deferred / 書き込みと検証が完了したら true（セッション無し・検証を後回しにした場合は false）
 * @throws The DB error of the in-line attempt; a deferred retry is scheduled first / その場の試行のDB例外（遅延再試行は登録済み）
 */
export async function recomputeSessionTotals(
  db: SessionTotalsDb,
  sessionId: number,
): Promise<boolean> {
  const defer = () => scheduleSessionRecompute(db, sessionId);
  let result: InlineResult;
  try {
    result = await recomputeInline(db, sessionId);
  } catch (err) {
    // NOTE: An exception can land AFTER this call's (possibly older) write and
    // before its verification read, so nothing proves the stored totals match
    // the rows — it must be retried like a contended write (re-re-review P1).
    log.warn({ err, sessionId }, '[session-cost] Recompute failed; deferred retry scheduled');
    defer();
    throw err;
  }
  if (result === 'converged') return true;
  if (result === 'missing') return false;
  log.warn({ sessionId }, '[session-cost] Totals contended in-line; deferred retry scheduled');
  defer();
  return false;
}

/**
 * Run every pending deferred recompute now (and any it re-schedules) until
 * none is left. For shutdown hooks and tests; production otherwise relies on
 * the timers.
 *
 * @param maxRounds - Upper bound of retry rounds / 再試行の最大ラウンド数
 */
export async function flushPendingSessionRecomputes(maxRounds?: number): Promise<void> {
  await retries.flush(maxRounds);
}

/**
 * Number of sessions whose totals are awaiting a deferred, verified recompute.
 *
 * @returns Pending session count / 未反映のセッション数
 */
export function pendingSessionRecomputeCount(): number {
  return retries.size();
}

/**
 * Apply one saved execution's usage to its session: the LLM call count is a
 * per-invocation number and is incremented; cost/tokens are recomputed.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param sessionId - Owning session / 所属セッション
 * @param usage.incLlmCalls - Calls made by this save, if any / 今回の呼び出し回数
 * @param usage.recompute - Whether cost/tokens changed / 費用・トークンの更新有無
 */
export async function updateSessionUsage(
  db: SessionTotalsDb,
  sessionId: number,
  usage: { incLlmCalls: number | null; recompute: boolean },
): Promise<void> {
  await db.agentSession.update({
    where: { id: sessionId },
    data: {
      totalLlmCallCount: usage.incLlmCalls ? { increment: usage.incLlmCalls } : undefined,
      lastActivityAt: new Date(),
    },
  });
  if (usage.recompute) await recomputeSessionTotals(db, sessionId);
}

/**
 * Record LLM usage that is not an AgentExecution (e.g. prompt optimisation)
 * as an AgentAction of the session, then recompute — so the usage is stored
 * where every later recompute reads it, instead of being added to the total
 * directly and erased by the next recompute.
 *
 * @param db - Prisma client / Prisma クライアント
 * @param params - Session, action type, task and tokens / セッション・種別・タスク・トークン
 */
export async function recordSessionActionUsage(
  db: SessionTotalsDb & {
    agentAction: {
      create(args: {
        data: {
          sessionId: number;
          actionType: string;
          targetTaskId?: number;
          tokensUsed: number;
          status: string;
        };
      }): Promise<unknown>;
    };
  },
  params: { sessionId: number; actionType: string; taskId?: number; tokensUsed: number },
): Promise<void> {
  await db.agentAction.create({
    data: {
      sessionId: params.sessionId,
      actionType: params.actionType,
      targetTaskId: params.taskId,
      tokensUsed: Math.max(0, Math.round(params.tokensUsed || 0)),
      status: 'success',
    },
  });
  await recomputeSessionTotals(db, params.sessionId);
}
