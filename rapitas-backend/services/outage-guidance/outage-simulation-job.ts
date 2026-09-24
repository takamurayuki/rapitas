/**
 * outage-simulation-job
 *
 * Periodic "test mode" backlog job (kind `outage_simulation`): back-tests the
 * outage classifier against the inventory's past incidents and posts the
 * accuracy summary to Slack. A missing inventory is a normal "not configured"
 * state, not an error. Scheduling lives in backlog-scheduler.ts.
 */
import { createLogger } from '../../config/logger';
import {
  loadInventory,
  InventoryNotFoundError,
  InventoryValidationError,
} from './inventory-loader';
import { simulate } from './outage-simulation';
import { buildSimulationSlackPayload, sendOutageSlack } from './outage-slack-notifier';

const log = createLogger('outage-guidance:simulation-job');

/**
 * Runs one back-test and publishes its summary.
 *
 * @returns Number of incidents evaluated (0 when no usable inventory) / 評価したインシデント数
 */
export async function runOutageSimulationJob(): Promise<number> {
  let loaded;
  try {
    loaded = await loadInventory();
  } catch (err) {
    if (err instanceof InventoryNotFoundError) {
      // Info, not warn: the job is on by default and most installs have no inventory.
      log.info({ path: err.path }, 'No outage-guidance inventory — simulation skipped');
      return 0;
    }
    if (err instanceof InventoryValidationError) {
      log.warn({ issues: err.issues }, 'Invalid outage-guidance inventory — simulation skipped');
      return 0;
    }
    throw err;
  }

  const report = simulate(loaded.inventory);
  const summary = { total: report.total, accuracy: report.accuracy, status: report.status };
  if (report.status === 'failed') {
    log.warn(
      { ...summary, mismatches: report.mismatches.length },
      'Outage guidance accuracy below threshold',
    );
  } else {
    log.info(summary, 'Outage guidance simulation finished');
  }
  await sendOutageSlack(buildSimulationSlackPayload(report, loaded.inventory.team));
  return report.total;
}
