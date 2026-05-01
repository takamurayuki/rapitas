/**
 * Diagnostic: print the actual SQLite columns / row counts that
 * `getSelfObservationSummary` reads, so we can see what's missing.
 */
import { Database } from 'bun:sqlite';

const dbPath = process.env.DB_PATH || 'C:/Projects/rapitas/rapitas-desktop/.data/rapitas-dev.db';
const db = new Database(dbPath, { readonly: true });
try {
  const cols = db.query("PRAGMA table_info('AgentExecution')").all() as Array<{
    name: string;
    type: string;
  }>;
  console.log('AgentExecution columns:');
  for (const c of cols) console.log(`  ${c.name} (${c.type})`);

  const tables = (
    db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Workflow%'")
      .all() as Array<{
      name: string;
    }>
  ).map((t) => t.name);
  console.log('\nWorkflow* tables:', tables.join(', '));

  const cnt = db.query('SELECT COUNT(*) AS c FROM AgentExecution').get() as { c: number };
  console.log('\nAgentExecution row count:', cnt.c);

  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - 13);
  const rows = db
    .query(
      'SELECT inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUsd, modelName FROM AgentExecution WHERE createdAt >= ? LIMIT 3',
    )
    .all(cutoff.toISOString());
  console.log('\nSample rows (last 14 days):', JSON.stringify(rows, null, 2));
} catch (e) {
  console.log('ERROR:', (e as Error).message);
} finally {
  db.close();
}
