/**
 * session-cost-totals
 *
 * Recomputes an AgentSession's totalCostUsd / totalTokensUsed from its
 * AgentExecution rows using the incremental attribution in
 * execution-cost-attribution.ts. Not responsible for writing execution rows.
 *
 * Why recompute instead of increment: an execution row's costUsd and
 * tokensUsed hold the Claude CLI's SESSION-cumulative totals. Incrementing the
 * session by each saved value counted every resume's history again (a
 * `--resume` reporting 0.00456 after a 0.00257 run added 0.00713 for a session
 * that cost 0.00456), so the session total drifted above real spend with every
 * repair cycle. Summing attributed increments is exact for both shapes.
 */
import { attributeIncrementalCosts } from './execution-cost-attribution';

/** The two Prisma delegates this needs (structural, so tests can pass fakes). */
export interface SessionTotalsDb {
  agentExecution: {
    findMany(args: {
      where: { sessionId: number };
      select: { costUsd: true; tokensUsed: true; claudeSessionId: true; startedAt: true };
    }): Promise<
      Array<{
        costUsd: unknown;
        tokensUsed: number | null;
        claudeSessionId: string | null;
        startedAt: Date | null;
      }>
    >;
  };
  agentSession: {
    update(args: {
      where: { id: number };
      data: {
        totalCostUsd?: number;
        totalTokensUsed?: number;
        totalLlmCallCount?: { increment: number };
        lastActivityAt: Date;
      };
    }): Promise<unknown>;
  };
}

/**
 * Pure: session totals implied by its execution rows.
 *
 * @param rows - The session's execution rows / セッションの実行行
 * @returns Attributed cost and token totals / 増分で合算した費用とトークン
 */
export function sessionTotalsFromRows(
  rows: ReadonlyArray<{
    costUsd: unknown;
    tokensUsed: number | null;
    claudeSessionId: string | null;
    startedAt: Date | null;
  }>,
): { totalCostUsd: number; totalTokensUsed: number } {
  const cost = attributeIncrementalCosts(rows).reduce((a, b) => a + b, 0);
  // tokensUsed is cumulative per CLI session exactly like costUsd (#1302), so
  // the same increment walk applies.
  const tokens = attributeIncrementalCosts(
    rows.map((r) => ({
      costUsd: r.tokensUsed ?? 0,
      claudeSessionId: r.claudeSessionId,
      startedAt: r.startedAt,
    })),
  ).reduce((a, b) => a + b, 0);
  return { totalCostUsd: Math.round(cost * 1e6) / 1e6, totalTokensUsed: Math.round(tokens) };
}

/**
 * Rewrite a session's cost/token totals from its execution rows.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param sessionId - Session to recompute / 再計算するセッション
 */
export async function recomputeSessionTotals(
  db: SessionTotalsDb,
  sessionId: number,
): Promise<void> {
  const rows = await db.agentExecution.findMany({
    where: { sessionId },
    select: { costUsd: true, tokensUsed: true, claudeSessionId: true, startedAt: true },
  });
  const totals = sessionTotalsFromRows(rows);
  await db.agentSession.update({
    where: { id: sessionId },
    data: { ...totals, lastActivityAt: new Date() },
  });
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
