/**
 * Supervision Router
 *
 * Route definitions for /agents/supervision. Thin layer — delegates to
 * supervision-handlers.ts.
 */
import { Elysia } from 'elysia';
import {
  handleExternalHeartbeat,
  handleGetAcceptanceStatus,
  handleListGaps,
  handleListInterventions,
  handleRecordIntervention,
} from './supervision-handlers';

export const supervisionRouter = new Elysia({ prefix: '/agents/supervision' })
  .get('/acceptance-status', (ctx) => handleGetAcceptanceStatus(ctx))
  .get('/interventions', (ctx) => handleListInterventions(ctx))
  .get('/gaps', (ctx) => handleListGaps(ctx))
  .post('/interventions', (ctx) => handleRecordIntervention(ctx))
  .post('/heartbeat', (ctx) => handleExternalHeartbeat(ctx));
