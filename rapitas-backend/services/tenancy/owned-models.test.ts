/**
 * owned-models registry
 *
 * The registry comes from the generated Prisma client; the schema source is
 * the thing it is supposed to reflect. This compares the two, so the registry
 * cannot quietly disagree with the schema it was generated from.
 *
 * Two different failures land here, and the messages distinguish them:
 *   - a model gained the column in the schema but the client is stale
 *     (locally: the backend has not restarted since the schema change; CI
 *     always runs `prisma generate` first, so there it means a real gap)
 *   - a root model was added to the schema without the column, which
 *     tests/schema/workspace-tenancy.test.ts catches from the other side
 */
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getOwnedModels, TENANCY_OWN_MODELS } from './owned-models';

const SCHEMA_DIR = join(dirname(dirname(import.meta.dir)), 'prisma', 'schema');

/** Model names whose schema body declares a workspaceId field. */
function modelsWithColumnInSchema(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.prisma'))) {
    const text = readFileSync(join(SCHEMA_DIR, f), 'utf8');
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (/^\s*workspaceId\s+Int\??/m.test(m[2])) out.add(m[1]);
    }
  }
  return out;
}

const fromSchema = modelsWithColumnInSchema();
const owned = getOwnedModels();

describe('the registry reflects the schema', () => {
  it('found models at all — the comparison is not between two empty sets', () => {
    expect(fromSchema.size).toBeGreaterThan(40);
    expect(owned.size).toBeGreaterThan(40);
  });

  it('every schema model with the column is in the registry', () => {
    const missing = [...fromSchema]
      .filter((m) => !TENANCY_OWN_MODELS.has(m) && !owned.has(m))
      .sort();
    expect(missing).toEqual([]);
  });

  it('the registry claims nothing the schema does not have', () => {
    const extra = [...owned].filter((m) => !fromSchema.has(m)).sort();
    expect(extra).toEqual([]);
  });

  it('excludes tenancy’s own tables, which carry the column but must not be filtered', () => {
    for (const m of TENANCY_OWN_MODELS) {
      expect(fromSchema.has(m) || m === 'Workspace').toBe(true);
      expect(owned.has(m)).toBe(false);
    }
  });

  it('excludes models that inherit through a parent', () => {
    for (const m of ['Task', 'Theme', 'Comment', 'TaskLabel', 'TimeEntry']) {
      expect(owned.has(m)).toBe(false);
    }
  });

  it('includes the ones the operator will actually notice', () => {
    for (const m of ['Category', 'Note', 'KnowledgeEntry', 'TimelineEvent', 'Notification']) {
      expect(owned.has(m)).toBe(true);
    }
  });
});
