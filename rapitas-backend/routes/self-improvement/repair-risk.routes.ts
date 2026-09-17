/**
 * repair-risk routes
 *
 * HTTP API exposing the repair-risk tactic effectiveness comparison (fired vs
 * not-fired bounce rate and MTTR). Thin layer — the aggregation lives in
 * repair-risk-effectiveness.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { computeRepairRiskEffectiveness } from '../../services/self-improvement/repair-risk-effectiveness';
import { repairRiskWindowDays } from '../../services/workflow/learning/repair-risk-constants';

const log = createLogger('routes:repair-risk');

const MAX_WINDOW_DAYS = 365;

const repairRiskRoutes = new Elysia({ prefix: '/self-improvement/repair-risk' })
  /** Fired vs not-fired cohort comparison over a trailing window. */
  .get(
    '/effectiveness',
    async ({ query, set }) => {
      const raw = query.windowDays ? parseInt(query.windowDays, 10) : repairRiskWindowDays();
      if (!Number.isInteger(raw) || raw <= 0 || raw > MAX_WINDOW_DAYS) {
        set.status = 400;
        return {
          success: false,
          error: `windowDays は 1〜${MAX_WINDOW_DAYS} の整数で指定してください`,
        };
      }
      try {
        return { success: true, ...(await computeRepairRiskEffectiveness(raw)) };
      } catch (err) {
        log.error({ err }, 'Failed to compute repair-risk effectiveness');
        set.status = 500;
        return { success: false, error: '効果測定の集計に失敗しました' };
      }
    },
    { query: t.Object({ windowDays: t.Optional(t.String()) }) },
  );

export default repairRiskRoutes;
