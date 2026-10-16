/**
 * pr-risk.routes.test
 *
 * Route-level tests via Elysia handle() against an in-memory PrRiskDb:
 * config read/update (422 on invalid input, 409 when entering `auto` with an
 * untrained model), critical-incident registration, and the metrics listing.
 */
import { describe, it, expect } from 'bun:test';
import { createPrRiskRoutes } from './pr-risk.routes';
import { createFakeDb } from '../../services/self-improvement/pr-risk/pr-risk-fake-db.test-helpers';
import { writeConfig } from '../../services/self-improvement/pr-risk/pr-risk-store';

const BASE = 'http://localhost/self-improvement/pr-risk';

function app() {
  const f = createFakeDb();
  return { ...f, routes: createPrRiskRoutes(f.db) };
}

const json = (method: string, url: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET/PUT /self-improvement/pr-risk/config', () => {
  it('returns defaults (stage off) before anything is configured', async () => {
    const res = await app().routes.handle(new Request(`${BASE}/config`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      stage: 'off',
      threshold: 0.5,
      modelVersion: 0,
      stageChangedAt: null,
    });
  });

  it('moves the stage display → hold and stamps stageChangedAt', async () => {
    const a = app();
    let res = await a.routes.handle(json('PUT', `${BASE}/config`, { stage: 'display' }));
    expect(res.status).toBe(200);
    res = await a.routes.handle(json('PUT', `${BASE}/config`, { stage: 'hold', threshold: 0.7 }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: true, stage: 'hold', threshold: 0.7 });
    expect(body.stageChangedAt).not.toBeNull();
  });

  it('rejects an unknown stage or an out-of-range threshold with 422', async () => {
    const a = app();
    for (const bad of [{ stage: 'yolo' }, { threshold: 0 }, { threshold: 1 }, { threshold: 'x' }]) {
      const res = await a.routes.handle(json('PUT', `${BASE}/config`, bad));
      expect(res.status).toBe(422);
    }
    expect(a.tables.prRiskConfig.rows).toHaveLength(0);
  });

  it('refuses auto with an untrained model (409) and allows it once trained', async () => {
    const a = app();
    let res = await a.routes.handle(json('PUT', `${BASE}/config`, { stage: 'auto' }));
    expect(res.status).toBe(409);
    await writeConfig(a.db, { modelVersion: 1 });
    res = await a.routes.handle(json('PUT', `${BASE}/config`, { stage: 'auto' }));
    expect(res.status).toBe(200);
  });
});

describe('POST /self-improvement/pr-risk/incidents', () => {
  it('labels the PR failure / critical_incident', async () => {
    const a = app();
    const res = await a.routes.handle(
      json('POST', `${BASE}/incidents`, { repo: 'o/r', prNumber: 12, note: 'prod down 30min' }),
    );
    expect(res.status).toBe(200);
    expect(a.tables.prOutcome.rows[0]).toMatchObject({
      repo: 'o/r',
      prNumber: 12,
      label: 'failure',
      failureKind: 'critical_incident',
      incidentNote: 'prod down 30min',
    });
  });

  it('rejects malformed input with 422', async () => {
    const a = app();
    for (const bad of [
      { repo: 'no-slash', prNumber: 1, note: 'x' },
      { repo: 'o/r', prNumber: 0, note: 'x' },
      { repo: 'o/r', prNumber: 1, note: '' },
    ]) {
      const res = await a.routes.handle(json('POST', `${BASE}/incidents`, bad));
      expect(res.status).toBe(422);
    }
    expect(a.tables.prOutcome.rows).toHaveLength(0);
  });
});

describe('GET /self-improvement/pr-risk/metrics', () => {
  it('lists monthly metrics and threshold reviews newest first', async () => {
    const a = app();
    for (const month of ['2026-07', '2026-08']) {
      await a.db.prRiskMonthlyMetric.upsert({
        where: { month },
        create: {
          month,
          sample: 1,
          tp: 1,
          fp: 0,
          fn: 0,
          tn: 0,
          precision: 1,
          recall: 1,
          fpr: null,
          threshold: 0.5,
          modelVersion: 0,
        },
        update: {},
      });
    }
    const res = await a.routes.handle(new Request(`${BASE}/metrics`));
    const body = (await res.json()) as { metrics: Array<{ month: string }>; reviews: unknown[] };
    expect(res.status).toBe(200);
    expect(body.metrics.map((m) => m.month)).toEqual(['2026-08', '2026-07']);
    expect(body.reviews).toEqual([]);
  });
});
