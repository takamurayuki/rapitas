/**
 * decision-trace/consistency-checker
 *
 * Asynchronous verification that a recorded decision's stated reasoning is
 * consistent with the eventual execution outcome. The verdict logic is one
 * pure function (`judgeConsistency`) so it can later be swapped for an LLM
 * judge without touching the batch plumbing. Heuristic-only by design (MVP):
 * no LLM calls, no added latency on the execution path.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import type { ConsistencyState, DecisionTraceClient } from './types';
import { isCapabilityAttributableFailure } from '../../workflow/routing-policy';

const log = createLogger('decision-trace');

// Structural cast — see the AgentDecisionTraceDelegate NOTE in types.ts
// (delegate may be missing from a stale worktree-generated client).
const db = prisma as unknown as DecisionTraceClient;

/** Rows examined per batch run (cost cap — leftovers wait for the next run). */
const BATCH_SIZE = 50;

/** AgentExecution.status values that are final (anything else = still running). */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked']);

/** Reason wording that shows the decision anticipated a possible failure. */
const RISK_AWARE_RE = /リスク|失敗する可能性|フォールバック|might fail|risk/i;

/** Verdict produced by `judgeConsistency`. */
export interface ConsistencyVerdict {
  consistency: ConsistencyState;
  note: string;
}

/**
 * Judges whether a decision's recorded reasoning is consistent with the
 * execution outcome. Pure — the swappable core of the checker.
 *
 * @param execution - Terminal execution outcome / 終端状態の実行結果
 * @param decision - Persisted reasoning fields / 記録済みの理由フィールド
 * @returns Consistency verdict and note / 整合性判定と注記
 */
export function judgeConsistency(
  execution: { status: string; errorMessage: string | null },
  decision: { adoptedReason: string; rejectedReasons: string },
): ConsistencyVerdict {
  if (execution.status === 'completed') {
    return { consistency: 'consistent', note: '実行が正常完了' };
  }
  if (execution.status === 'blocked') {
    return { consistency: 'skipped', note: 'ブロック状態のため評価対象外' };
  }
  // status === 'failed' (callers only pass terminal statuses)
  // A failure that says nothing about the decision cannot judge it. A spend
  // limit, a timeout or a provider 5xx would have greeted any choice equally,
  // so scoring the decision `inconsistent` for one would teach the router that
  // its reasoning was wrong when only the infrastructure was. This is the
  // ledger's `indeterminate`: recorded as `skipped` because the column has no
  // such state, but with a note that distinguishes 'not applicable' from
  // 'could not tell'.
  if (!isCapabilityAttributableFailure(execution.errorMessage)) {
    return {
      consistency: 'skipped',
      note: '判定不能: 失敗原因がモデルの能力に帰属しない(枠/タイムアウト/上流障害など)',
    };
  }

  const reasonBlob = `${decision.adoptedReason}\n${decision.rejectedReasons}`;
  if (RISK_AWARE_RE.test(reasonBlob)) {
    return { consistency: 'consistent', note: '想定されたリスクの範囲内での失敗' };
  }
  return {
    consistency: 'inconsistent',
    note: '採用理由が実行失敗を想定しておらず、事後の実行結果と乖離',
  };
}

/**
 * Processes one batch of pending AgentDecisionTrace rows: joins each to its
 * AgentExecution outcome and persists the verdict.
 *
 * Rows without an executionId are marked `skipped` immediately (so they do
 * not accumulate as pending forever); rows whose execution has not reached a
 * terminal status stay `pending` and are re-evaluated on the next run. A DB
 * failure aborts the batch with one warn log — untouched rows retry next run
 * (no per-row retry counter by design).
 *
 * @returns Number of rows examined and rows updated / 検査行数と更新行数
 */
export async function runConsistencyCheckBatch(): Promise<{ checked: number; updated: number }> {
  try {
    const pending = await db.agentDecisionTrace.findMany({
      where: { consistency: 'pending' },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (pending.length === 0) return { checked: 0, updated: 0 };

    let updated = 0;
    const now = new Date();

    const noExecution = pending.filter(
      (row: { executionId: number | null }) => row.executionId === null,
    );
    if (noExecution.length > 0) {
      await db.agentDecisionTrace.updateMany({
        where: { id: { in: noExecution.map((row: { id: number }) => row.id) } },
        data: {
          consistency: 'skipped',
          consistencyNote: '実行IDが未記録のため評価対象外',
          verifiedAt: now,
        },
      });
      updated += noExecution.length;
    }

    const withExecution = pending.filter(
      (row: { executionId: number | null }) => row.executionId !== null,
    );
    if (withExecution.length > 0) {
      const executionIds = [
        ...new Set(
          withExecution.map((row: { executionId: number | null }) => row.executionId as number),
        ),
      ];
      const executions = await prisma.agentExecution.findMany({
        where: { id: { in: executionIds } },
        select: { id: true, status: true, errorMessage: true },
      });
      const byId = new Map<number, { status: string; errorMessage: string | null }>(
        executions.map((e: { id: number; status: string; errorMessage: string | null }) => [
          e.id,
          { status: e.status, errorMessage: e.errorMessage },
        ]),
      );

      for (const row of withExecution) {
        const execution = byId.get(row.executionId as number);
        // Missing execution row (deleted) or still running → stay pending; a
        // deleted execution can never terminate, but distinguishing it from
        // "not yet visible" is not worth a false skip — the row is bounded by
        // the batch anyway.
        if (!execution || !TERMINAL_STATUSES.has(execution.status)) continue;
        const verdict = judgeConsistency(execution, {
          adoptedReason: row.adoptedReason,
          rejectedReasons: row.rejectedReasons,
        });
        await db.agentDecisionTrace.update({
          where: { id: row.id },
          data: {
            consistency: verdict.consistency,
            consistencyNote: verdict.note,
            verifiedAt: now,
          },
        });
        updated += 1;
      }
    }

    return { checked: pending.length, updated };
  } catch (err) {
    // Rows keep their pending state — the next scheduled run retries them.
    log.warn({ err }, 'consistency check batch failed (will retry next run)');
    return { checked: 0, updated: 0 };
  }
}
