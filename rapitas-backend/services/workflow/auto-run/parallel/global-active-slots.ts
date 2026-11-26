/**
 * 全選定経路で使う全体枠数。フェーズ間の予約枠を補い、
 * 停止・一時停止後に実行が終了した枠は数えない。
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { getGlobalAutoRunActiveCount } from '../auto-run-selection';
import { parseCompanions } from './companion-json';
import { HANG_BACKSTOP_HEARTBEAT_MS } from '../auto-run-liveness';

/** キューの生存判定と保存済みの動作中集合の大きい方を返す。 */
export async function countGlobalActiveSlots(
  prisma: PrismaClient,
  queueCount?: number,
): Promise<number> {
  const queued = queueCount ?? (await getGlobalAutoRunActiveCount(prisma));
  try {
    // 新列をselectしないため、旧クライアントでも先頭は数えられる。
    const rows = await prisma.themeAutoRun.findMany({});
    let reserved = 0;
    for (const row of rows) {
      const companions = parseCompanions(
        (row as unknown as { companionTasksJson?: unknown }).companionTasksJson,
      );
      const ids = [
        ...new Set([
          ...(row.currentTaskId != null ? [row.currentTaskId] : []),
          ...companions.map((c) => c.taskId),
        ]),
      ];
      if (row.status === 'running') {
        reserved += ids.length;
      } else if (ids.length > 0) {
        // 停止中の古い在籍情報だけで他テーマを塞がない。照会失敗は安全側。
        try {
          const live = await prisma.agentExecution.findMany({
            where: {
              status: 'running',
              heartbeatAt: { gte: new Date(Date.now() - HANG_BACKSTOP_HEARTBEAT_MS) },
              session: { config: { taskId: { in: ids } } },
            },
            select: { session: { select: { config: { select: { taskId: true } } } } },
          });
          reserved += new Set(
            live
              .map((e) => e.session?.config?.taskId)
              .filter((id) => id != null && ids.includes(id)),
          ).size;
        } catch {
          reserved += ids.length;
        }
      }
    }
    return Math.max(queued, reserved);
  } catch {
    return queued;
  }
}
