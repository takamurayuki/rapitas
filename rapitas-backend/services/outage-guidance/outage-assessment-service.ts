/**
 * outage-assessment-service
 *
 * Real-time entry point: loads the (cached) inventory, runs graph traversal +
 * classification for one service using its full incident history, and
 * measures that compute time. Does not send notifications.
 */
import { performance } from 'perf_hooks';
import { loadInventory } from './inventory-loader';
import { evaluateOutage } from './outage-classifier';
import type { OutageAssessment, OutageInventory } from './outage-guidance.types';

/** Thrown when the requested service is not in the inventory. */
export class ServiceNotFoundError extends Error {
  constructor(public readonly serviceId: string) {
    super(`Service not found in outage-guidance inventory: ${serviceId}`);
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * Assesses stopping `serviceId` against an already-loaded inventory.
 * `computedInMs` covers traversal + classification only.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @param serviceId - Service to stop / 停止対象のサービスID
 * @returns Timed assessment / 計測済みの判定結果
 * @throws {ServiceNotFoundError} When the id is unknown / IDが存在しない場合
 */
export function assessOutageInInventory(
  inventory: OutageInventory,
  serviceId: string,
): OutageAssessment {
  if (!inventory.services.some((s) => s.id === serviceId)) {
    throw new ServiceNotFoundError(serviceId);
  }
  const startedAt = performance.now();
  const history = inventory.incidents
    .filter((i) => i.targetServiceId === serviceId)
    .map((i) => i.actualRecoveryMinutes);
  const assessment = evaluateOutage(inventory, serviceId, history);
  assessment.computedInMs = performance.now() - startedAt;
  return assessment;
}

/**
 * Loads the configured inventory and assesses stopping `serviceId`.
 *
 * @param serviceId - Service to stop / 停止対象のサービスID
 * @returns Timed assessment / 計測済みの判定結果
 * @throws {InventoryNotFoundError | InventoryValidationError} From the loader / ローダ由来
 * @throws {ServiceNotFoundError} When the id is unknown / IDが存在しない場合
 */
export async function assessOutage(serviceId: string): Promise<OutageAssessment> {
  const { inventory } = await loadInventory();
  return assessOutageInInventory(inventory, serviceId);
}
