/**
 * inventory-loader tests — happy path, each validation rule, missing file,
 * mtime-keyed cache and path resolution.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadInventory,
  validateInventory,
  resolveInventoryPath,
  clearInventoryCache,
  InventoryNotFoundError,
  InventoryValidationError,
} from '../inventory-loader';

function validRaw(): Record<string, unknown> {
  return {
    version: 1,
    team: 'payments',
    services: [
      { id: 'api', name: 'API', layer: 'api', slaMinutes: 15, declaredRecoveryMinutes: 5 },
      { id: 'db', name: 'DB', layer: 'db', slaMinutes: 30, declaredRecoveryMinutes: 10 },
    ],
    dependencies: [{ from: 'api', to: 'db', kind: 'db_query' }],
    incidents: [
      {
        id: 'inc-1',
        targetServiceId: 'db',
        occurredAt: '2026-01-01T00:00:00Z',
        actualRecoveryMinutes: 12,
        actualImpactedServiceIds: ['api'],
      },
    ],
  };
}

function issuesOf(raw: unknown): string[] {
  try {
    validateInventory(raw);
  } catch (err) {
    if (err instanceof InventoryValidationError) return err.issues;
    throw err;
  }
  return [];
}

describe('validateInventory', () => {
  test('accepts a valid inventory', () => {
    const inv = validateInventory(validRaw());
    expect(inv.services).toHaveLength(2);
    expect(inv.team).toBe('payments');
  });

  test('rejects wrong version', () => {
    expect(issuesOf({ ...validRaw(), version: 2 }).join('\n')).toContain('version');
  });

  test('rejects duplicate service id', () => {
    const raw = validRaw();
    (raw.services as unknown[]).push({
      id: 'api',
      name: 'Dup',
      layer: 'api',
      slaMinutes: 1,
      declaredRecoveryMinutes: 1,
    });
    expect(issuesOf(raw).join('\n')).toContain('duplicate service id');
  });

  test('rejects invalid id format', () => {
    const raw = validRaw();
    (raw.services as Array<Record<string, unknown>>)[0].id = 'Bad ID';
    expect(issuesOf(raw).join('\n')).toContain('invalid service id');
  });

  test('rejects unknown dependency endpoint', () => {
    const raw = validRaw();
    raw.dependencies = [{ from: 'api', to: 'ghost', kind: 'api_call' }];
    expect(issuesOf(raw).join('\n')).toContain('unknown service "ghost"');
  });

  test('rejects self loop', () => {
    const raw = validRaw();
    raw.dependencies = [{ from: 'api', to: 'api', kind: 'api_call' }];
    expect(issuesOf(raw).join('\n')).toContain('self loop');
  });

  test('rejects out-of-enum layer and kind', () => {
    const raw = validRaw();
    (raw.services as Array<Record<string, unknown>>)[0].layer = 'queue';
    raw.dependencies = [{ from: 'api', to: 'db', kind: 'grpc' }];
    const joined = issuesOf(raw).join('\n');
    expect(joined).toContain('layer');
    expect(joined).toContain('kind');
  });

  test('rejects invalid date and unknown incident references', () => {
    const raw = validRaw();
    raw.incidents = [
      {
        id: 'inc-x',
        targetServiceId: 'ghost',
        occurredAt: 'yesterday',
        actualRecoveryMinutes: 1,
        actualImpactedServiceIds: ['nobody'],
      },
    ];
    const joined = issuesOf(raw).join('\n');
    expect(joined).toContain('occurredAt');
    expect(joined).toContain('targetServiceId');
    expect(joined).toContain('nobody');
  });

  test('rejects non-positive SLA and service count out of range', () => {
    const raw = validRaw();
    (raw.services as Array<Record<string, unknown>>)[0].slaMinutes = 0;
    expect(issuesOf(raw).join('\n')).toContain('slaMinutes');
    expect(
      issuesOf({ ...validRaw(), services: [], dependencies: [], incidents: [] }).join('\n'),
    ).toContain('services');
  });
});

describe('loadInventory', () => {
  let dir: string;
  const prevFile = process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
  const prevData = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'outage-inv-'));
    clearInventoryCache();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevFile === undefined) delete process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
    else process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = prevFile;
    if (prevData === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevData;
  });

  test('resolves the path from env, then the data dir', () => {
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = join(dir, 'x.json');
    expect(resolveInventoryPath()).toBe(join(dir, 'x.json'));
    delete process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
    process.env.RAPITAS_DATA_DIR = dir;
    expect(resolveInventoryPath()).toBe(join(dir, 'outage-guidance', 'inventory.json'));
  });

  test('loads and validates a file', async () => {
    const file = join(dir, 'inv.json');
    writeFileSync(file, JSON.stringify(validRaw()));
    const res = await loadInventory(file);
    expect(res.path).toBe(file);
    expect(res.inventory.dependencies).toHaveLength(1);
  });

  test('missing file throws InventoryNotFoundError', async () => {
    await expect(loadInventory(join(dir, 'none.json'))).rejects.toBeInstanceOf(
      InventoryNotFoundError,
    );
  });

  test('broken JSON throws InventoryValidationError', async () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ not json');
    await expect(loadInventory(file)).rejects.toBeInstanceOf(InventoryValidationError);
  });

  test('returns cached result until mtime changes', async () => {
    const file = join(dir, 'inv.json');
    writeFileSync(file, JSON.stringify(validRaw()));
    const first = await loadInventory(file);
    const second = await loadInventory(file);
    expect(second.inventory).toBe(first.inventory);

    writeFileSync(file, JSON.stringify({ ...validRaw(), team: 'search' }));
    const future = new Date(Date.now() + 60_000);
    utimesSync(file, future, future);
    const third = await loadInventory(file);
    expect(third.inventory).not.toBe(first.inventory);
    expect(third.inventory.team).toBe('search');
  });
});
