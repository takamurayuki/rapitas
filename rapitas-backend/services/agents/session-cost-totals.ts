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
 * - The absolute write is compare-and-swap on `lastActivityAt`: a recompute
 *   that read an older row set can never overwrite a newer total.
 * - Usage recorded outside AgentExecution (AgentAction.tokensUsed) is part of
 *   the total, so a later recompute does not erase it.
 */
import { attributeIncrementalCosts } from './execution-cost-attribution';
import { createLogger } from '../../config/logger';

const log = createLogger('agents:session-cost-totals');

/** CAS retries before giving up (the next recompute repairs the total). */
const MAX_CAS_ATTEMPTS = 5;

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
    findUnique(args: {
      where: { id: number };
      select: { lastActivityAt: true };
    }): Promise<{ lastActivityAt: Date } | null>;
    updateMany(args: {
      where: { id: number; lastActivityAt: Date };
      data: { totalCostUsd: number; totalTokensUsed: number; lastActivityAt: Date };
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

/**
 * Rewrite a session's cost/token totals from its recorded usage.
 * Compare-and-swap on `lastActivityAt`: if another writer touched the session
 * between our read and our write, re-read and recompute instead of writing a
 * total built from an older row set.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param sessionId - Session to recompute / 再計算するセッション
 * @returns True when the totals were written / 書き込めたら true
 */
export async function recomputeSessionTotals(
  db: SessionTotalsDb,
  sessionId: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const session = await db.agentSession.findUnique({
      where: { id: sessionId },
      select: { lastActivityAt: true },
    });
    if (!session) return false;
    const { rows, extraTokens } = await readUsage(db, sessionId);
    const totals = sessionTotalsFromRows(rows, { sessionId, extraTokens });
    // Strictly later than what we read, so a writer that read the same stamp
    // can never match after we wrote (same-millisecond writes included).
    const stamp = new Date(Math.max(Date.now(), session.lastActivityAt.getTime() + 1));
    const res = await db.agentSession.updateMany({
      where: { id: sessionId, lastActivityAt: session.lastActivityAt },
      data: { ...totals, lastActivityAt: stamp },
    });
    if (res.count > 0) return true;
  }
  log.warn({ sessionId }, '[session-cost] Totals not written after repeated concurrent updates');
  return false;
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
