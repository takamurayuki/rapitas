/**
 * Error Analytics Routes
 *
 * Exposes aggregated ERROR/WARN log statistics from the daily backend log
 * files. Data source: config/logger.ts daily NDJSON sink.
 * Does NOT use the in-memory ring buffer from error-capture.ts.
 */

import { Elysia, t } from 'elysia';
import { getErrorAnalytics } from '../../../services/system/error-analytics-service';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:error-analytics');

export const errorAnalyticsRoutes = new Elysia({ prefix: '/error-analytics' }).get(
  '/',
  ({ query }) => {
    try {
      const days = Number(query.days ?? 14);
      const result = getErrorAnalytics(days);
      return { success: true, data: result };
    } catch (err) {
      log.error({ err }, 'Error analytics aggregation failed');
      return { success: false, error: 'ログ集計中にエラーが発生しました' };
    }
  },
  {
    query: t.Object({
      days: t.Optional(t.Numeric({ minimum: 1, maximum: 30 })),
    }),
    detail: {
      tags: ['Monitoring'],
      summary: 'エラー分析データ',
      description:
        '日次ログファイルから ERROR/WARN を集計し、カテゴリ別件数・先週比・日次トレンドを返します',
    },
  },
);
