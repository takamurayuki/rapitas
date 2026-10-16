/**
 * causal-suggestion-filer
 *
 * Reads recent queue items, runs the root-cause detector and files each candidate as an
 * evidence-backed isolation suggestion in the concern backlog. Never changes task state.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { submitConcern } from '../../memory/concern-backlog-service';
import { countCorroboratingLogSignals, type LogSignalEntry } from './log-correlation';
import { detectRootCauses, CAUSAL_WINDOW_MS, type RootCauseCandidate } from './root-cause-detector';

const log = createLogger('causal-suggestion-filer');

/**
 * Builds the concern text for a candidate; the dedup key carries only the root taskId so
 * a recurrence of the same cause merges instead of re-filing.
 */
function toConcern(c: RootCauseCandidate, logSignals: number, themeId?: number) {
  const atRisk = c.atRiskIds.length
    ? `次に波及する恐れのある待機中タスク: ${c.atRiskIds.join(', ')}`
    : '待機中の波及先なし';
  return {
    title: `[連鎖障害] タスク #${c.taskId} を一時保留すると下流 ${c.downstreamFailedIds.length} 件の連鎖失敗を防げる可能性`,
    detail: [
      `根拠: ${c.evidence}`,
      `同時間帯のキュー停滞WARNログ: ${logSignals} 件 (Slow queue processing / Execution result ignored after cancellation)`,
      `信頼度: ${(c.confidence * 100).toFixed(0)}% (失敗した依存先 / 全依存先)`,
      atRisk,
      '',
      '提案: タスクを手動で一時保留(autoRunExcluded)して原因を調査してください。自動では隔離しません。',
    ].join('\n'),
    type: 'perf' as const,
    severity: 'medium' as const,
    themeId,
    source: 'log_health',
    dedupKey: `causal-root:${c.taskId}`,
  };
}

/**
 * Detects dependency-cascade root causes and files them as concerns. Failures are logged,
 * never thrown, so the surrounding health check always completes.
 *
 * @param themeId - Theme to attribute concerns to. / 懸念の帰属テーマ
 * @param logEntries - Today's parsed backend log entries, used as corroborating evidence. / 当日のログ
 * @param nowMs - Current epoch ms. / 現在時刻(ms)
 * @returns Number of suggestions filed. / 起票件数
 */
export async function fileCausalSuggestions(
  themeId?: number,
  logEntries: LogSignalEntry[] = [],
  nowMs = Date.now(),
): Promise<number> {
  try {
    const since = new Date(nowMs - 2 * CAUSAL_WINDOW_MS);
    const items = await prisma.workflowQueueItem.findMany({
      where: {
        OR: [
          { status: { in: ['queued', 'running', 'waiting_approval'] } },
          { updatedAt: { gte: since } },
        ],
      },
      select: {
        taskId: true,
        status: true,
        dependencies: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });
    const candidates = detectRootCauses(items, nowMs);
    for (const c of candidates) {
      await submitConcern(toConcern(c, countCorroboratingLogSignals(c, logEntries), themeId));
    }
    return candidates.length;
  } catch (err) {
    log.error({ err }, 'Causal analysis failed (non-fatal)');
    return 0;
  }
}
