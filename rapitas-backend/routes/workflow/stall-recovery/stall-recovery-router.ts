/**
 * stall-recovery-router
 *
 * Route definitions for the accessible stall-recovery UI (thin layer):
 * GET /workflow/stall-check (on-demand stall scan, no throttle) and
 * POST /workflow/tasks/:taskId/recover (user-approved recovery execution).
 */
import { Elysia, t } from 'elysia';
import { handleRecover, handleStallCheck } from './stall-recovery-handlers';

export const stallRecoveryRoutes = new Elysia()

  // On-demand stall scan for the Ctrl+Alt+S panel. Read-only: files no
  // concerns and repairs nothing.
  .get('/workflow/stall-check', async ({ query }) => handleStallCheck(query), {
    query: t.Object({ verbosity: t.Optional(t.String()) }),
  })

  // Executes ONE recovery action. Only called after explicit user approval
  // (Space) in the panel — never invoked automatically.
  .post(
    '/workflow/tasks/:taskId/recover',
    async ({ params, body }) => handleRecover(params, body as { action?: string }),
    {
      params: t.Object({ taskId: t.String() }),
      body: t.Object({ action: t.String() }),
    },
  );
