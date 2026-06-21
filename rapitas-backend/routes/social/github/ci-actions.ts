/**
 * GitHub CI/CD Action Routes
 *
 * GitHub Actions workflow runs and job log endpoints.
 * Does not include integration CRUD or PR/Issue operations.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import {
  listWorkflowRuns,
  getWorkflowRun,
  getWorkflowRunLog,
  getWorkflowJobLog,
} from '../../../services/github/actions';
import { resolveIntegrationOrThrow } from '../../../services/github/resource-guard';

export const ciActionRoutes = new Elysia()
  // CI/CD: list a repo's recent GitHub Actions workflow runs.
  .get('/integrations/:id/runs', async (context) => {
    const { id } = context.params as { id: string };
    const { limit } = context.query as { limit?: string };
    const integration = await prisma.gitHubIntegration.findUnique({ where: { id: parseInt(id) } });
    if (!integration) return [];
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    try {
      return await listWorkflowRuns(repo, limit ? parseInt(limit) : 20);
    } catch (err) {
      context.set.status = 502;
      return { error: err instanceof Error ? err.message : 'CI/CD 実行履歴の取得に失敗しました' };
    }
  })

  // CI/CD: a single run with its jobs/steps.
  .get('/integrations/:id/runs/:runId', async (context) => {
    const { id, runId } = context.params as { id: string; runId: string };
    const integration = await resolveIntegrationOrThrow(id);
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    try {
      return await getWorkflowRun(repo, parseInt(runId));
    } catch (err) {
      context.set.status = 502;
      return { error: err instanceof Error ? err.message : '実行詳細の取得に失敗しました' };
    }
  })

  // CI/CD: a run's logs (?failed=true returns only the failed steps' output).
  .get('/integrations/:id/runs/:runId/log', async (context) => {
    const { id, runId } = context.params as { id: string; runId: string };
    const { failed } = context.query as { failed?: string };
    const integration = await resolveIntegrationOrThrow(id);
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    const log = await getWorkflowRunLog(repo, parseInt(runId), failed === 'true');
    return { log };
  })

  // CI/CD: a single job's log, parsed into per-step sections (for grandchild
  // step expansion in the CI/CD view).
  .get('/integrations/:id/jobs/:jobId/log', async (context) => {
    const { id, jobId } = context.params as { id: string; jobId: string };
    const integration = await resolveIntegrationOrThrow(id);
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    try {
      const sections = await getWorkflowJobLog(repo, parseInt(jobId));
      return { sections };
    } catch (err) {
      context.set.status = 502;
      return { error: err instanceof Error ? err.message : 'ジョブログの取得に失敗しました' };
    }
  });
