/**
 * daily-report-service
 *
 * Persistence layer + job runner of the autonomous-activity daily report
 * (task #564): fetches the last-24h raw rows (read-only DB + cycle NDJSON),
 * runs the pure aggregation core, applies the fail-open AI polish, and writes
 * ONE notification (type='daily_report') that doubles as the /agents/daily-report
 * archive entry. Aggregation lives in daily-report-core, rendering in
 * daily-report-format; this module re-exports both as the public entry point.
 */
import { readFile } from 'fs/promises';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getCycleLogFilePath } from '../observability/cycle-event-logger';
import { createNotification } from '../communication/notification-service';
import { buildNotificationI18n } from '../communication/notification-i18n';
import {
  DAILY_REPORT_WINDOW_MS,
  buildDailyReportData,
  localDateStamp,
  type DailyReportRaw,
} from './daily-report-core';
import {
  aiFormatDailyReport,
  formatDailyReport,
  formatDailyReportSummary,
} from './daily-report-format';

// Public API surface: consumers (scheduler, routes, tests) import everything
// from this module — the core/format files are internal structure.
export * from './daily-report-core';
export * from './daily-report-format';

const log = createLogger('reporting:daily-report');

/**
 * Title of the daily-report notification — also the idempotency key.
 *
 * @param date - Local YYYY-MM-DD report day / レポート対象日
 * @returns Notification title / 通知タイトル
 */
export function dailyReportTitle(date: string): string {
  return `デイリーレポート ${date}`;
}

/**
 * Count `restart.triggered` cycle events inside the window. The 24h window can
 * span two daily NDJSON files (today + yesterday). Best-effort: a missing or
 * unreadable file contributes 0 — filesystem trouble must not kill the report.
 *
 * @param windowStart - Window start / 窓の開始
 * @param now - Window end / 窓の終了
 * @returns Restart count from the cycle log / cycle log 由来の再起動回数
 */
export async function countCycleLogRestarts(windowStart: Date, now: Date): Promise<number> {
  const stamps = [...new Set([localDateStamp(windowStart), localDateStamp(now)])];
  let count = 0;
  for (const stamp of stamps) {
    let text: string;
    try {
      text = await readFile(getCycleLogFilePath(stamp), 'utf8');
    } catch {
      continue; // Missing day file — the dev-restart path may simply not have run.
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as { evt?: string; t?: string };
        if (rec.evt !== 'restart.triggered' || !rec.t) continue;
        const at = new Date(rec.t);
        if (at >= windowStart && at <= now) count++;
      } catch {
        // Skip malformed lines.
      }
    }
  }
  return count;
}

/**
 * Fetch every raw ingredient for the report window. Read-only against the DB.
 *
 * @param windowStart - Window start / 窓の開始
 * @param now - Window end / 窓の終了
 * @returns Raw rows for buildDailyReportData / 集計コアへの入力
 */
export async function collectDailyReportData(
  windowStart: Date,
  now: Date,
): Promise<DailyReportRaw> {
  const completed = await prisma.task.findMany({
    where: { status: { in: ['done', 'completed'] }, completedAt: { gte: windowStart, lte: now } },
    select: { id: true, title: true, completedAt: true },
    orderBy: { completedAt: 'asc' },
  });

  // Resolve linked PR numbers for the completed tasks in one query.
  const prByTask = new Map<number, number>();
  if (completed.length > 0) {
    const linked = await prisma.gitHubPullRequest.findMany({
      where: { linkedTaskId: { in: completed.map((t) => t.id) } },
      select: { prNumber: true, linkedTaskId: true },
    });
    for (const pr of linked) {
      if (pr.linkedTaskId != null && !prByTask.has(pr.linkedTaskId)) {
        prByTask.set(pr.linkedTaskId, pr.prNumber);
      }
    }
  }

  const [prs, concerns, decisions, themes, queueCandidates, restartNotifications] =
    await Promise.all([
      // NOTE: mergedAt column does not exist — the updatedAt window is a
      // documented approximation (metadata carries approximate:true). The
      // state is stored lowercase 'merged' by sync-webhook.
      prisma.gitHubPullRequest.findMany({
        where: { state: 'merged', updatedAt: { gte: windowStart, lte: now } },
        select: { prNumber: true, title: true, url: true },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.knowledgeEntry.findMany({
        where: { sourceType: 'concern', createdAt: { gte: windowStart, lte: now } },
        select: { id: true, title: true, tags: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.decisionLog.findMany({
        where: { createdAt: { gte: windowStart, lte: now } },
        select: {
          id: true,
          decision: true,
          rationale: true,
          context: true,
          predictedOutcome: true,
          confidence: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.themeAutoRun.findMany({ select: { themeId: true, enabled: true, status: true } }),
      // Top-level pending tasks; 'blocked' rows are excluded by status. The
      // exact selection order is theme-scoped — this is a cross-theme preview.
      prisma.task.findMany({
        where: { status: 'todo', parentId: null },
        select: { id: true, title: true, priority: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      // Second restart path: auto-restart-merged-code records a Notification
      // (title='自動再起動') and never writes a cycle event — disjoint sources.
      prisma.notification.count({
        where: { title: '自動再起動', createdAt: { gte: windowStart, lte: now } },
      }),
    ]);

  const fromCycleLog = await countCycleLogRestarts(windowStart, now);

  return {
    tasks: completed.map((t) => ({
      id: t.id,
      title: t.title,
      completedAt: t.completedAt,
      prNumber: prByTask.get(t.id) ?? null,
    })),
    prs,
    concerns,
    decisions,
    restarts: { fromCycleLog, fromNotifications: restartNotifications },
    themes,
    queueCandidates,
  };
}

/**
 * Run one daily report: idempotency check → collect → aggregate → AI format
 * (fail-open to plain tables) → notification. The notification IS the archive
 * row read by /agents/daily-report (plan decision: single write, always consistent).
 *
 * @returns 1 when a report was created, 0 when today's already exists / 作成件数
 */
export async function runDailyReport(): Promise<number> {
  const now = new Date();
  const date = localDateStamp(now);
  const title = dailyReportTitle(date);

  // Second defence beside the scheduler's once-per-day guard: a manual
  // run-now after the scheduled run must not produce a duplicate archive row.
  const existing = await prisma.notification.findFirst({
    where: { type: 'daily_report', title },
    select: { id: true },
  });
  if (existing) {
    log.info({ date }, '[daily-report] Report already exists for today — skipping');
    return 0;
  }

  const windowStart = new Date(now.getTime() - DAILY_REPORT_WINDOW_MS);
  const raw = await collectDailyReportData(windowStart, now);
  const data = buildDailyReportData(raw, now);

  let reportMarkdown = formatDailyReport(data);
  let aiFormatted = false;
  // Empty day: skip the AI call entirely (weekly-review's short-circuit
  // pattern) — the plain report already states the zeros / satiation reason.
  if (!data.empty) {
    try {
      reportMarkdown = await aiFormatDailyReport(data);
      aiFormatted = true;
    } catch (err) {
      // Fail-open (K-5197): the report must ship even when the aux AI cannot
      // run — the plain aggregate tables are the guaranteed fallback.
      log.warn({ err, date }, '[daily-report] AI formatting failed — using plain aggregate');
    }
  }

  const summaryMessage = formatDailyReportSummary(data);
  await createNotification({
    type: 'daily_report',
    title,
    message: summaryMessage,
    link: '/agents/daily-report',
    i18n: buildNotificationI18n('daily_report', { date, message: summaryMessage }),
    metadata: {
      date,
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
      aiFormatted,
      satiated: data.satiated,
      satiatedReason: data.satiatedReason,
      counts: {
        completed: data.completedTasks.length,
        mergedPrs: data.mergedPrs.items.length,
        concerns: data.concerns.total,
        decisions: data.decisions.length,
        restarts: data.restartCount,
        interventions: data.humanIntervention.count,
      },
      sections: {
        completedTasks: data.completedTasks,
        mergedPrs: data.mergedPrs,
        concernsBySource: data.concerns.bySource,
        learnings: data.learnings,
        decisions: data.decisions,
        upcomingQueue: data.upcomingQueue,
        restartBreakdown: data.restartBreakdown,
        humanIntervention: data.humanIntervention,
      },
      reportMarkdown,
    },
  });

  log.info(
    { date, aiFormatted, satiated: data.satiated, completed: data.completedTasks.length },
    '[daily-report] Daily report created',
  );
  return 1;
}
