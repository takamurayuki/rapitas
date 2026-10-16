/**
 * repair-iteration-metrics
 *
 * Validates/sanitizes the response of GET /tasks/:taskId/repair-iterations
 * (task #672, operator-approved MVP-limited scope: change-set size + dwell
 * time only — test-pass-rate delta and learning velocity are intentionally
 * NOT part of this data, see RepairIterationMetricsPanel). NOT responsible
 * for fetching or rendering — pure data validation only.
 */

/** One repair-loop iteration as returned by GET /tasks/:taskId/repair-iterations. */
export interface RepairIterationMetricEntry {
  id: string;
  cause: 'verify_repair' | 'ci_repair';
  createdAt: string;
  dwellTimeMs: number | null;
  changeSet: { filesChanged: number; additions: number; deletions: number } | null;
}

const REPAIR_CAUSES = new Set(['verify_repair', 'ci_repair']);

function isChangeSet(v: unknown): v is RepairIterationMetricEntry['changeSet'] {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.filesChanged === 'number' &&
    typeof c.additions === 'number' &&
    typeof c.deletions === 'number'
  );
}

/**
 * Filter the raw API response down to well-formed iteration entries, dropping
 * any row with an unexpected shape rather than throwing (same defensive
 * posture as critic-history.ts's malformed-metadata handling).
 *
 * @param raw - Unknown value from the fetch response's `iterations` field. / APIレスポンスの生値
 * @returns Well-formed entries only. / 検証済みエントリ
 */
export function parseRepairIterationMetrics(raw: unknown): RepairIterationMetricEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RepairIterationMetricEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.id === 'string' &&
      typeof r.cause === 'string' &&
      REPAIR_CAUSES.has(r.cause) &&
      typeof r.createdAt === 'string' &&
      (r.dwellTimeMs === null || typeof r.dwellTimeMs === 'number') &&
      isChangeSet(r.changeSet)
    ) {
      out.push({
        id: r.id,
        cause: r.cause as RepairIterationMetricEntry['cause'],
        createdAt: r.createdAt,
        dwellTimeMs: r.dwellTimeMs as number | null,
        changeSet: r.changeSet as RepairIterationMetricEntry['changeSet'],
      });
    }
  }
  return out;
}
