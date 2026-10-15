/**
 * outage-guidance routes tests — response shapes, error mapping
 * (404 inventory/service, 422 invalid) and the notify flag.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import outageGuidanceRoute from './outage-guidance.routes';
import { clearInventoryCache } from '../../services/outage-guidance/inventory-loader';

const FIXTURE = join(
  import.meta.dir,
  '..',
  '..',
  'services',
  'outage-guidance',
  '__tests__',
  '__fixtures__',
  'team-inventory.json',
);

const app = new Elysia().use(outageGuidanceRoute);

async function call(
  method: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.handle(new Request(`http://localhost${path}`, { method }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('outage-guidance routes', () => {
  const prev = process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'outage-route-'));
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = FIXTURE;
    clearInventoryCache();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
    else process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = prev;
  });

  test('GET /inventory summarizes the inventory', async () => {
    const { status, body } = await call('GET', '/outage-guidance/inventory');
    expect(status).toBe(200);
    expect(body).toEqual({
      path: FIXTURE,
      team: 'payments-platform',
      serviceCount: 15,
      dependencyCount: 20,
      incidentCount: 51,
    });
  });

  test('GET /assess/:serviceId returns the assessment with evidence paths', async () => {
    const { status, body } = await call('GET', '/outage-guidance/assess/orders-db?notify=false');
    expect(status).toBe(200);
    expect(['safe', 'risk', 'danger']).toContain(body.verdict as string);
    expect(body.targetServiceId).toBe('orders-db');
    expect(Array.isArray(body.affected)).toBe(true);
    expect((body.affected as Array<{ path: string[] }>)[0].path.at(-1)).toBe('orders-db');
    expect(body.computedInMs as number).toBeLessThan(100);
    expect(body.notification).toBe('skipped');
  });

  test('notify defaults to skipped', async () => {
    const { body } = await call('GET', '/outage-guidance/assess/gateway');
    expect(body.notification).toBe('skipped');
  });

  test('unknown service → 404 service_not_found', async () => {
    const { status, body } = await call('GET', '/outage-guidance/assess/ghost');
    expect(status).toBe(404);
    expect(body.error).toBe('service_not_found');
  });

  test('missing inventory → 404 inventory_not_found', async () => {
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = join(dir, 'none.json');
    const { status, body } = await call('GET', '/outage-guidance/assess/gateway');
    expect(status).toBe(404);
    expect(body.error).toBe('inventory_not_found');
    expect(body.path).toBe(join(dir, 'none.json'));
  });

  test('invalid inventory → 422 inventory_invalid with issues', async () => {
    const file = join(dir, 'bad.json');
    writeFileSync(
      file,
      JSON.stringify({ version: 2, services: [], dependencies: [], incidents: [] }),
    );
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = file;
    const { status, body } = await call('GET', '/outage-guidance/inventory');
    expect(status).toBe(422);
    expect(body.error).toBe('inventory_invalid');
    expect((body.issues as string[]).length).toBeGreaterThan(0);
  });

  test('POST /simulate runs the back-test on demand', async () => {
    const { status, body } = await call('POST', '/outage-guidance/simulate?notify=false');
    expect(status).toBe(200);
    expect(body.status).toBe('passed');
    expect(body.accuracy as number).toBeGreaterThanOrEqual(0.9);
    expect(body.notification).toBe('skipped');
  });
});
