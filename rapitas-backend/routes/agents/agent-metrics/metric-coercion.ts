/**
 * Metric Coercion Helpers
 *
 * Defensive numeric coercion shared by the agent-metrics query modules.
 * Exists because legacy IPC bugs left double-JSON-encoded strings (e.g.
 * `"\"0\""`) in AgentExecution.costUsd, and Prisma Decimal columns arrive
 * as objects that only expose toString().
 */

/**
 * Convert Prisma Decimal | string | number to a JS number.
 * Auto-unwraps up to 5 nested JSON-string layers before parsing as float.
 *
 * @param v - Raw column value from Prisma / Prismaから取得した生の値
 * @returns Finite number, or 0 when unparseable / パース不能時は0
 */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let current: unknown = v;
  for (let i = 0; i < 5; i++) {
    if (typeof current !== 'string') break;
    if (current.length === 0) return 0;
    if (current[0] !== '"') break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  if (typeof current === 'number') return Number.isFinite(current) ? current : 0;
  if (typeof current === 'string') {
    const n = parseFloat(current);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma Decimal exposes toString()
  const n = parseFloat(String(current));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Defensive integer coercion mirroring `toNumber`.
 *
 * @param v - Raw column value from Prisma / Prismaから取得した生の値
 * @returns Truncated finite integer, or 0 / 切り捨て整数（不能時は0）
 */
export function toInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return Math.trunc(toNumber(v));
}
