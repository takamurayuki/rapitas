/**
 * model-tier-table/executor-model
 *
 * Finds which model implemented a task, so review seats can be held to "at
 * least the executor's tier". Reads the implementer's pinned route
 * (model-route-stability's `model_route_pin` timeline event) — the model the
 * phase was routed to. Not responsible for routing.
 */
import { createLogger } from '../../../config/logger';

const log = createLogger('model-tier-table:executor-model');

/** Must match model-route-stability.ts's EVENT_TYPE and correlation format. */
const PIN_EVENT_TYPE = 'model_route_pin';
const correlation = (taskId: number, role: string) => `route_${taskId}_${role}`;

/**
 * The model the task's implementer phase was routed to, newest pin first.
 *
 * Fails open to null (unknown executor): the seats then keep their own tier
 * floors, which is what they had before this lookup existed.
 *
 * @param taskId - Task under review / レビュー対象のタスクID
 * @returns Model id, or null when unknown / 不明なら null
 */
export async function resolveExecutorModel(taskId: number): Promise<string | null> {
  try {
    // Lazy: the review path imports this module, and many test files mock the
    // timeline without queryEvents — a static import would fail their import.
    const { queryEvents } = await import('../../memory/timeline');
    const { events } = await queryEvents({
      eventType: PIN_EVENT_TYPE,
      correlationId: correlation(taskId, 'implementer'),
      limit: 5,
    });
    for (const event of events) {
      const payload = (
        typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
      ) as { decision?: { recommendedModel?: unknown } } | null;
      const model = payload?.decision?.recommendedModel;
      if (typeof model === 'string' && model.trim()) return model;
    }
  } catch (err) {
    log.debug({ err, taskId }, 'executor model lookup failed — treating as unknown');
  }
  return null;
}
