/**
 * TaskSpecRoutes
 *
 * Endpoint for deriving a structured task spec (goals / constraints / acceptance
 * criteria) from a free-text description via AI. Stateless — does not create or
 * mutate tasks.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { deriveTaskSpec } from '../../services/task/task-spec-deriver';

const log = createLogger('routes:task-spec');

export const taskSpecRoutes = new Elysia({ prefix: '/tasks' }).post(
  '/derive-spec',
  async ({ body }) => {
    const { description } = body as { description: string };
    const { spec, source } = await deriveTaskSpec(description);
    log.debug({ source }, 'derive-spec');
    return {
      success: source === 'ai' || source === 'empty',
      source,
      goals: spec.goals,
      constraints: spec.constraints,
      acceptanceCriteria: spec.acceptanceCriteria,
    };
  },
  {
    body: t.Object({ description: t.String() }),
  },
);
