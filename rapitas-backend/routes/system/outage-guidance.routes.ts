/**
 * outage-guidance routes
 *
 * HTTP API for the dependency-graph based outage guidance: inventory summary,
 * real-time stop assessment (optionally posted to Slack) and on-demand
 * back-test. Thin layer — all logic lives in services/outage-guidance.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  loadInventory,
  InventoryNotFoundError,
  InventoryValidationError,
} from '../../services/outage-guidance/inventory-loader';
import {
  assessOutageInInventory,
  ServiceNotFoundError,
} from '../../services/outage-guidance/outage-assessment-service';
import { simulate } from '../../services/outage-guidance/outage-simulation';
import {
  buildOutageSlackPayload,
  buildSimulationSlackPayload,
  sendOutageSlack,
  type OutageSlackPayload,
} from '../../services/outage-guidance/outage-slack-notifier';

const log = createLogger('routes:outage-guidance');

const notifyQuery = t.Object({ notify: t.Optional(t.String()) });

/**
 * Maps known domain errors to HTTP status + body; rethrows anything else.
 *
 * @param err - Thrown value / スローされた値
 * @param set - Elysia response setter / レスポンス設定
 * @returns Error body / エラーレスポンス
 */
function toErrorResponse(err: unknown, set: { status?: number | string }): Record<string, unknown> {
  if (err instanceof InventoryNotFoundError) {
    set.status = 404;
    return { error: 'inventory_not_found', path: err.path };
  }
  if (err instanceof InventoryValidationError) {
    set.status = 422;
    return { error: 'inventory_invalid', issues: err.issues };
  }
  if (err instanceof ServiceNotFoundError) {
    set.status = 404;
    return { error: 'service_not_found', serviceId: err.serviceId };
  }
  throw err;
}

/**
 * Fire-and-forget Slack post so the Slack round-trip stays out of the
 * real-time budget.
 */
function queueNotification(payload: OutageSlackPayload): 'queued' {
  void sendOutageSlack(payload).catch((err) =>
    log.warn({ err }, 'Outage guidance Slack notification failed'),
  );
  return 'queued';
}

const outageGuidanceRoutes = new Elysia({ prefix: '/outage-guidance' })
  /** Summary of the configured inventory. */
  .get('/inventory', async ({ set }) => {
    try {
      const { inventory, path } = await loadInventory();
      return {
        path,
        team: inventory.team ?? null,
        serviceCount: inventory.services.length,
        dependencyCount: inventory.dependencies.length,
        incidentCount: inventory.incidents.length,
      };
    } catch (err) {
      return toErrorResponse(err, set);
    }
  })

  /** Three-level stop verdict with evidence paths; notify=true posts it to Slack. */
  .get(
    '/assess/:serviceId',
    async ({ params, query, set }) => {
      try {
        const { inventory } = await loadInventory();
        const assessment = assessOutageInInventory(inventory, params.serviceId);
        let notification: 'queued' | 'skipped' = 'skipped';
        if (query.notify === 'true') {
          const names = Object.fromEntries(inventory.services.map((s) => [s.id, s.name]));
          notification = queueNotification(buildOutageSlackPayload(assessment, names));
        }
        return { ...assessment, notification };
      } catch (err) {
        return toErrorResponse(err, set);
      }
    },
    { params: t.Object({ serviceId: t.String() }), query: notifyQuery },
  )

  /** On-demand back-test ("test mode") against past incidents. */
  .post(
    '/simulate',
    async ({ query, set }) => {
      try {
        const { inventory } = await loadInventory();
        const report = simulate(inventory);
        let notification: 'queued' | 'skipped' = 'skipped';
        if (query.notify === 'true') {
          notification = queueNotification(buildSimulationSlackPayload(report, inventory.team));
        }
        return { ...report, notification };
      } catch (err) {
        return toErrorResponse(err, set);
      }
    },
    { query: notifyQuery },
  );

export default outageGuidanceRoutes;
