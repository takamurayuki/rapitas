/**
 * outage-simulation
 *
 * Pure back-test ("test mode") of the outage classifier against past
 * incidents: each incident is predicted using only earlier incidents as
 * history and compared to a ground truth derived from what actually happened.
 * Does no IO — the periodic job and route wrap it.
 */
import {
  classifyOutage,
  computeBlastRatio,
  evaluateOutage,
  toleranceFor,
} from './outage-classifier';
import {
  ACCURACY_THRESHOLD,
  MIN_SIMULATION_INCIDENTS,
  type IncidentRecord,
  type OutageInventory,
  type OutageVerdict,
  type SimulationMismatch,
  type SimulationReport,
} from './outage-guidance.types';

/**
 * Ground-truth verdict of an incident: the operator label when present,
 * otherwise the verdict rule applied to measured values (actual recovery,
 * actual impacted set). History suppression is off — these are facts, not
 * estimates.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @param incident - Past incident / 過去インシデント
 * @returns Expected verdict / 正解の判定
 */
export function expectedVerdict(
  inventory: OutageInventory,
  incident: IncidentRecord,
): OutageVerdict {
  if (incident.label) return incident.label;
  const impacted = incident.actualImpactedServiceIds.filter(
    (id) => id !== incident.targetServiceId,
  );
  return classifyOutage({
    recoveryMinutes: incident.actualRecoveryMinutes,
    toleranceMinutes: toleranceFor(inventory, [incident.targetServiceId, ...impacted]),
    blastRatio: computeBlastRatio(new Set(impacted).size, inventory.services.length),
    historySamples: 0,
    requireHistory: false,
  }).verdict;
}

function emptyConfusion(): Record<OutageVerdict, Record<OutageVerdict, number>> {
  const row = (): Record<OutageVerdict, number> => ({ safe: 0, risk: 0, danger: 0 });
  return { safe: row(), risk: row(), danger: row() };
}

/**
 * Back-tests every incident in chronological order.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @param now - Evaluation timestamp / 評価時刻
 * @returns Accuracy report with confusion matrix and mismatches / 精度レポート
 */
export function simulate(inventory: OutageInventory, now: Date = new Date()): SimulationReport {
  const incidents = [...inventory.incidents].sort((a, b) => {
    const diff = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const confusion = emptyConfusion();
  const mismatches: SimulationMismatch[] = [];
  let correct = 0;

  for (const incident of incidents) {
    const at = Date.parse(incident.occurredAt);
    // Strictly earlier only — same-timestamp incidents must not leak into each other.
    const history = incidents
      .filter(
        (p) => p.targetServiceId === incident.targetServiceId && Date.parse(p.occurredAt) < at,
      )
      .map((p) => p.actualRecoveryMinutes);
    const predicted = evaluateOutage(inventory, incident.targetServiceId, history).verdict;
    const expected = expectedVerdict(inventory, incident);
    confusion[expected][predicted] += 1;
    if (predicted === expected) correct += 1;
    else mismatches.push({ incidentId: incident.id, expected, predicted });
  }

  const total = incidents.length;
  const accuracy = total === 0 ? 0 : correct / total;
  const status =
    total < MIN_SIMULATION_INCIDENTS
      ? 'insufficient_data'
      : accuracy >= ACCURACY_THRESHOLD
        ? 'passed'
        : 'failed';
  return {
    total,
    correct,
    accuracy,
    threshold: ACCURACY_THRESHOLD,
    status,
    confusion,
    mismatches,
    evaluatedAt: now.toISOString(),
  };
}
