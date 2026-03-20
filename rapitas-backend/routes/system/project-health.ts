/**
 * ProjectHealthRoutes
 *
 * API endpoints for project health monitoring.
 */
import { Elysia, t } from 'elysia';
import {
  checkProjectHealth,
  runProjectHealthScan,
} from '../../services/analytics/project-health-monitor';

export const projectHealthRoutes = new Elysia({ prefix: '/project-health' })
  /**
   * Run health scan across all monitored projects.
   */
  .get('/scan', async () => {
    const report = await runProjectHealthScan();
    return { success: true, data: report };
  })

  /**
   * Check health of a specific project directory.
   */
  .post(
    '/check',
    async (context) => {
      const { body } = context;
      const { workingDirectory, projectName } = body as {
        workingDirectory: string;
        projectName?: string;
      };
      const items = await checkProjectHealth(
        workingDirectory,
        projectName || workingDirectory,
      );
      return { success: true, data: { items } };
    },
    {
      body: t.Object({
        workingDirectory: t.String(),
        projectName: t.Optional(t.String()),
      }),
    },
  );
