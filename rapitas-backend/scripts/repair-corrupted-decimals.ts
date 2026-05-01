/**
 * repair-corrupted-decimals
 *
 * Standalone repair script + library used by `ensureDesktopSqliteDatabase`
 * for startup auto-repair.
 *
 * Problem
 * -------
 * Past versions of the agent-worker IPC layer occasionally double-JSON-
 * encoded numeric fields when persisting `AgentExecution.costUsd`. The
 * column ended up with values like `"\"0\""` (a JSON string containing the
 * JSON string `"0"`), which the Prisma SQLite Decimal deserializer rejects
 * with a parse error. The visible symptom is the dashboard widget
 * returning `Failed to fetch self-observation summary` because
 * `prisma.agentExecution.findMany({ select: { costUsd: ... } })` throws
 * before the route can format a response.
 *
 * Repair
 * ------
 * Walk every row, detect strings whose first character is `"`, JSON-parse
 * (recursively if needed) until we get a plain numeric string, then write
 * it back. Token columns get the same treatment defensively even though
 * they are INTEGER — a stray string-typed value would still fail
 * Prisma's type assertion.
 *
 * Usage
 * -----
 *   bun run scripts/repair-corrupted-decimals.ts          # one-off CLI
 *   import { repairCorruptedDecimals } from './repair-corrupted-decimals';
 *   await repairCorruptedDecimals(databasePath);          # called from startup
 */
import { Database } from 'bun:sqlite';

interface RepairStats {
  scanned: number;
  costUsdRepaired: number;
  tokenColsRepaired: number;
  errors: number;
}

/**
 * Recursively unwrap layers of JSON-encoded strings until we hit something
 * that isn't a JSON-encoded string. Preserves NaN-safe numeric output.
 */
function unwrapJsonLayers(raw: unknown): string {
  let current: unknown = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof current !== 'string') break;
    if (current.length === 0) return '0';
    if (current[0] !== '"') break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  if (current === null || current === undefined) return '0';
  if (typeof current === 'number') return Number.isFinite(current) ? String(current) : '0';
  if (typeof current === 'string') {
    const n = parseFloat(current);
    return Number.isFinite(n) ? String(n) : '0';
  }
  return '0';
}

/**
 * Repair corrupted Decimal / Int columns on AgentExecution.
 * Returns stats — never throws on individual row errors so the caller can
 * keep booting even if a few rows are unfixable.
 *
 * @param databasePath - Path to the SQLite database file
 * @returns Repair statistics
 */
export function repairCorruptedDecimals(databasePath: string): RepairStats {
  const stats: RepairStats = {
    scanned: 0,
    costUsdRepaired: 0,
    tokenColsRepaired: 0,
    errors: 0,
  };
  const db = new Database(databasePath);
  try {
    const tableExists = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='AgentExecution'")
      .get();
    if (!tableExists) return stats;

    const rows = db
      .query(
        'SELECT id, costUsd, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, tokensUsed FROM AgentExecution',
      )
      .all() as Array<{
      id: number;
      costUsd: unknown;
      inputTokens: unknown;
      outputTokens: unknown;
      cacheReadInputTokens: unknown;
      cacheCreationInputTokens: unknown;
      tokensUsed: unknown;
    }>;
    stats.scanned = rows.length;

    const updateStmt = db.prepare(
      'UPDATE AgentExecution SET costUsd = ?, inputTokens = ?, outputTokens = ?, cacheReadInputTokens = ?, cacheCreationInputTokens = ?, tokensUsed = ? WHERE id = ?',
    );

    for (const r of rows) {
      try {
        const newCost = unwrapJsonLayers(r.costUsd);
        const costChanged = String(r.costUsd) !== newCost && r.costUsd !== Number(newCost);

        const intFields: Array<keyof typeof r> = [
          'inputTokens',
          'outputTokens',
          'cacheReadInputTokens',
          'cacheCreationInputTokens',
          'tokensUsed',
        ];
        const fixed: Record<string, number> = {};
        let intsChanged = false;
        for (const f of intFields) {
          const v = r[f];
          if (typeof v === 'number' && Number.isFinite(v)) {
            fixed[f] = v;
            continue;
          }
          const unwrapped = unwrapJsonLayers(v);
          const n = parseInt(unwrapped, 10);
          fixed[f] = Number.isFinite(n) ? n : 0;
          if (typeof v !== 'number') intsChanged = true;
        }

        if (costChanged || intsChanged) {
          updateStmt.run(
            newCost,
            fixed.inputTokens,
            fixed.outputTokens,
            fixed.cacheReadInputTokens,
            fixed.cacheCreationInputTokens,
            fixed.tokensUsed,
            r.id,
          );
          if (costChanged) stats.costUsdRepaired++;
          if (intsChanged) stats.tokenColsRepaired++;
        }
      } catch {
        stats.errors++;
      }
    }
  } finally {
    db.close();
  }
  return stats;
}

// CLI entrypoint
if (import.meta.main) {
  const dbPath =
    process.env.DB_PATH ||
    process.argv[2] ||
    'C:/Projects/rapitas/rapitas-desktop/.data/rapitas-dev.db';
  console.log(`[repair] Scanning ${dbPath} ...`);
  const stats = repairCorruptedDecimals(dbPath);
  console.log('[repair] Done:', JSON.stringify(stats, null, 2));
}
