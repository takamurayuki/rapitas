/**
 * Repair AgentSession.totalCostUsd values that were stored as JSON-quoted
 * strings (e.g. `"1.463031"`) instead of plain numerics. These cause Prisma
 * to throw `P2023 Inconsistent column data` when reading the row.
 */
import { Database } from 'bun:sqlite';

const dbPath = process.argv[2] || 'C:/Projects/rapitas/rapitas-desktop/.data/rapitas-dev.db';
const db = new Database(dbPath);

const all = db
  .query('SELECT id, totalCostUsd, typeof(totalCostUsd) as t FROM AgentSession')
  .all() as Array<{ id: number; totalCostUsd: unknown; t: string }>;

let fixed = 0;
let skipped = 0;
let firstSamples: Array<{ id: number; before: unknown; after: number }> = [];

for (const row of all) {
  const v = row.totalCostUsd;
  let needsFix = false;
  let parsed: number | null = null;

  if (typeof v === 'string') {
    // Strip enclosing quotes if present (JSON-stringified value).
    const trimmed = v.replace(/^"+|"+$/g, '').trim();
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      parsed = n;
      needsFix = true;
    } else {
      console.warn(`row id=${row.id}: unparseable string value "${v}" — defaulting to 0`);
      parsed = 0;
      needsFix = true;
    }
  } else if (v !== null && typeof v !== 'number') {
    console.warn(`row id=${row.id}: unexpected type ${row.t}, value`, v);
    parsed = 0;
    needsFix = true;
  }

  if (needsFix && parsed !== null) {
    db.run('UPDATE AgentSession SET totalCostUsd = ? WHERE id = ?', [parsed, row.id]);
    fixed++;
    if (firstSamples.length < 5) firstSamples.push({ id: row.id, before: v, after: parsed });
  } else {
    skipped++;
  }
}

console.log(`Scanned: ${all.length}, fixed: ${fixed}, skipped: ${skipped}`);
if (firstSamples.length > 0) {
  console.log('Samples of repaired rows:');
  for (const s of firstSamples)
    console.log(`  id=${s.id}: ${JSON.stringify(s.before)} → ${s.after}`);
}

db.close();
