/**
 * daily-report-routes
 *
 * Read-only HTTP API for the /agents/growth daily-report archive. The archive
 * rows ARE the daily_report notifications (plan decision: single write keeps
 * notification and archive consistent) — this layer only lists and parses
 * them. Report generation lives in daily-report-service.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../config/database';
import { createLogger } from '../config/logger';
import { dailyReportTitle } from '../services/reporting/daily-report-service';

const log = createLogger('routes:daily-report');

/** Parses the notification metadata JSON column, or null when absent/broken. */
function parseMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const dailyReportRoutes = new Elysia({ prefix: '/growth' })
  /** List archived daily reports, newest first (summary rows for the list UI). */
  .get('/daily-reports', async () => {
    const rows = await prisma.notification.findMany({
      where: { type: 'daily_report' },
      orderBy: { createdAt: 'desc' },
      take: 90,
      select: { id: true, title: true, message: true, metadata: true, createdAt: true },
    });
    return {
      reports: rows.map((r) => {
        const meta = parseMetadata(r.metadata);
        return {
          id: r.id,
          date: typeof meta?.date === 'string' ? meta.date : r.title.replace(/^デイリーレポート /, ''),
          summary: r.message,
          satiated: meta?.satiated === true,
          aiFormatted: meta?.aiFormatted === true,
          counts: meta?.counts ?? null,
          createdAt: r.createdAt,
        };
      }),
    };
  })

  /** Full report for one day: counts, sections, and the report markdown. */
  .get(
    '/daily-reports/:date',
    async ({ params, set }) => {
      const row = await prisma.notification.findFirst({
        where: { type: 'daily_report', title: dailyReportTitle(params.date) },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) {
        set.status = 404;
        return { error: '指定日のデイリーレポートが見つかりません' };
      }
      const meta = parseMetadata(row.metadata);
      if (!meta) {
        // A daily_report row always carries metadata; a broken JSON column is
        // logged, and the summary is still returned so the UI shows something.
        log.warn({ id: row.id }, '[daily-report] Notification metadata unparsable');
      }
      return {
        report: {
          id: row.id,
          date: params.date,
          summary: row.message,
          createdAt: row.createdAt,
          windowStart: meta?.windowStart ?? null,
          windowEnd: meta?.windowEnd ?? null,
          aiFormatted: meta?.aiFormatted === true,
          satiated: meta?.satiated === true,
          satiatedReason: typeof meta?.satiatedReason === 'string' ? meta.satiatedReason : null,
          counts: meta?.counts ?? null,
          sections: meta?.sections ?? null,
          reportMarkdown: typeof meta?.reportMarkdown === 'string' ? meta.reportMarkdown : null,
        },
      };
    },
    { params: t.Object({ date: t.String() }) },
  );
