/**
 * briefing-hook
 *
 * Collects held-task data and runs the briefing delivery after the daily
 * report. Fail-open: nothing here may break runDailyReport.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { createNotification } from '../../communication/notification-service';
import {
  deliverBriefing,
  resolveBriefingDataDir,
  type BriefingDeliveryResult,
} from './briefing-delivery';
import { getBriefingTtsAdapter } from './briefing-tts-adapter';
import type { BriefingInput, DecisionCandidate } from './briefing-types';

const log = createLogger('reporting:briefing');

/** Fixed, structured answer options for a held task decision. */
const HELD_DECISION_OPTIONS = ['再開する', '計画を見直す', '破棄する'];

/**
 * Collect blocked / paused tasks and decision candidates.
 *
 * @param completed - Completed tasks already aggregated / 集計済み完了タスク
 * @param date - Report day / 対象日
 * @returns Structured briefing input / 構造化入力
 */
export async function collectBriefingInput(
  completed: BriefingInput['completed'],
  date: string,
): Promise<BriefingInput> {
  const rows = await prisma.task.findMany({
    where: { status: { in: ['blocked', 'paused'] }, parentId: null },
    select: { id: true, title: true, status: true, priority: true, dueDate: true },
    orderBy: { id: 'asc' },
    take: 50,
  });
  const held = rows.map((r) => ({
    id: r.id,
    title: r.title,
    reason: r.status === 'paused' ? '一時停止中' : 'ブロック中',
  }));
  const decisionCandidates: DecisionCandidate[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      title: r.title,
      priority: r.priority ?? 'medium',
      dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
      blockingCount: await prisma.task.count({ where: { parentId: r.id, status: 'todo' } }),
      reason: r.status,
      options: HELD_DECISION_OPTIONS,
    })),
  );
  return {
    date,
    completed,
    held,
    decisionCandidates,
    linkUrl: `/agents/daily-report?date=${date}`,
  };
}

/**
 * Run the briefing for the day; never throws.
 *
 * @param completed - Completed tasks of the window / 窓内の完了タスク
 * @param date - Report day / 対象日
 * @returns Delivery result or null when the hook itself failed / 配信結果
 */
export async function runBriefingHook(
  completed: BriefingInput['completed'],
  date: string,
): Promise<BriefingDeliveryResult | null> {
  try {
    const input = await collectBriefingInput(completed, date);
    const result = await deliverBriefing(input, {
      dataDir: resolveBriefingDataDir(),
      tts: getBriefingTtsAdapter(),
      notify: async (p) => {
        await createNotification({ type: 'system', ...p });
      },
      // The text daily_report notification was already created by the caller,
      // so the fallback only records why audio is missing.
      fallbackNotify: async (message) => {
        log.warn(
          { date, message },
          '[briefing] Audio delivery failed — text report is the fallback',
        );
      },
    });
    log.info({ date, status: result.status }, '[briefing] Briefing processed');
    return result;
  } catch (err) {
    log.error({ err, date }, '[briefing] Briefing hook failed');
    return null;
  }
}
