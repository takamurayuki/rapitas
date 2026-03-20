/**
 * TechDebtRoutes
 *
 * API endpoints for tech debt scanning and management.
 */
import { Elysia, t } from 'elysia';
import { scanForTechDebt, runScheduledTechDebtScan } from '../../services/tech-debt-liquidator';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:tech-debt');

export const techDebtRoutes = new Elysia({ prefix: '/tech-debt' })
  /**
   * Scan a specific directory for tech debt.
   */
  .post(
    '/scan',
    async (context) => {
      const { body } = context;
      try {
        const workingDirectory = (body as { workingDirectory: string }).workingDirectory;
        if (!workingDirectory) {
          return { success: false, error: 'workingDirectory is required' };
        }

        const result = await scanForTechDebt(workingDirectory);
        return { success: true, data: result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error({ error: msg }, '[TechDebt] Scan failed');
        return { success: false, error: msg };
      }
    },
    {
      body: t.Object({
        workingDirectory: t.String(),
      }),
    },
  )

  /**
   * Run a full scan across all themes (same as scheduled job, but manual trigger).
   */
  .post('/scan-all', async () => {
    try {
      const digest = await runScheduledTechDebtScan();
      return { success: true, data: digest };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, '[TechDebt] Full scan failed');
      return { success: false, error: msg };
    }
  });
