/**
 * GET /agents/probe-metrics 統合テスト
 *
 * 記録0件 / targetId別の集計 / windowDays クエリによる期間境界を、実 store
 * （RAPITAS_DATA_DIR=一時ディレクトリ）経由で検証する。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { probeMetricsRoutes } = await import('../../../routes/agents/config/probe-metrics');
const { appendRecord } = await import('../../../services/ai/probe-metrics');
type ProbeAttemptRecord = import('../../../services/ai/probe-metrics').ProbeAttemptRecord;

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRecord(overrides: Partial<ProbeAttemptRecord> = {}): ProbeAttemptRecord {
  return {
    tsMs: Date.now(),
    taskId: 673,
    role: 'researcher',
    targetId: 'db',
    outcome: 'success',
    attempts: 1,
    latencyMs: 12,
    errorMessage: null,
    ...overrides,
  };
}

interface MetricsResponse {
  metrics: Array<{
    targetId: string;
    attempts: number;
    successRate: number;
    avgLatencyMs: number;
  }>;
  windowDays: number;
  minSamples: number;
  generatedAtMs: number;
}

describe('GET /agents/probe-metrics', () => {
  let app: Elysia;
  let dir: string;
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'probe-metrics-route-'));
    process.env.RAPITAS_DATA_DIR = dir;
    app = new Elysia().use(probeMetricsRoutes);
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('記録0件なら metrics:[] を 200 で返す', async () => {
    const res = await app.handle(new Request('http://localhost/agents/probe-metrics'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as MetricsResponse;
    expect(body.metrics).toEqual([]);
    expect(body.windowDays).toBe(45);
    expect(body.minSamples).toBe(8);
    expect(typeof body.generatedAtMs).toBe('number');
  });

  it('targetId 別に正しく集計する', async () => {
    appendRecord(makeRecord({ outcome: 'success' }));
    appendRecord(makeRecord({ outcome: 'permanent_failure' }));
    appendRecord(makeRecord({ targetId: 'agent-endpoint', outcome: 'success' }));

    const res = await app.handle(new Request('http://localhost/agents/probe-metrics'));
    const body = (await res.json()) as MetricsResponse;

    expect(body.metrics).toHaveLength(2);
    const db = body.metrics.find((m) => m.targetId === 'db');
    expect(db).toMatchObject({ attempts: 2, successRate: 0.5 });
    const agentEndpoint = body.metrics.find((m) => m.targetId === 'agent-endpoint');
    expect(agentEndpoint).toMatchObject({ attempts: 1, successRate: 1 });
  });

  it('?windowDays= が期間境界として効く（窓外レコードは集計されない）', async () => {
    appendRecord(makeRecord({ tsMs: Date.now() - 3 * DAY_MS }));

    const inWindow = (await (
      await app.handle(new Request('http://localhost/agents/probe-metrics?windowDays=7'))
    ).json()) as MetricsResponse;
    expect(inWindow.windowDays).toBe(7);
    expect(inWindow.metrics).toHaveLength(1);

    const outOfWindow = (await (
      await app.handle(new Request('http://localhost/agents/probe-metrics?windowDays=1'))
    ).json()) as MetricsResponse;
    expect(outOfWindow.windowDays).toBe(1);
    expect(outOfWindow.metrics).toEqual([]);
  });
});
