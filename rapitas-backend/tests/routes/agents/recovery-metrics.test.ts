/**
 * GET /agents/recovery-metrics 統合テスト
 *
 * 記録0件 / 混在レコード / windowDays クエリによる期間境界を、実 store
 * （RAPITAS_DATA_DIR=一時ディレクトリ）経由で検証する。あわせて既存
 * GET /agents/cooldowns の互換維持を確認する。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { recoveryMetricsRoutes } = await import('../../../routes/agents/config/recovery-metrics');
const { providerCooldownsRoutes } =
  await import('../../../routes/agents/config/provider-cooldowns');
const { appendRecord } = await import('../../../services/ai/recovery-metrics');
type RecoveryAttemptRecord = import('../../../services/ai/recovery-metrics').RecoveryAttemptRecord;

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRecord(overrides: Partial<RecoveryAttemptRecord> = {}): RecoveryAttemptRecord {
  return {
    tsMs: Date.now(),
    taskId: 641,
    phase: 'planner',
    errorType: 'quota',
    fromProvider: 'openai',
    fromModel: 'gpt-5',
    toProvider: 'claude',
    strategy: 'reroute',
    outcome: 'success',
    latencyMs: 1000,
    costUsd: 0.1,
    failureReason: null,
    ...overrides,
  };
}

interface MetricsResponse {
  metrics: Array<{
    errorType: string;
    strategy: string;
    attempts: number;
    successRate: number;
    avgCostUsd: number | null;
  }>;
  windowDays: number;
  minSamples: number;
  generatedAtMs: number;
}

describe('GET /agents/recovery-metrics', () => {
  let app: Elysia;
  let dir: string;
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recovery-metrics-route-'));
    process.env.RAPITAS_DATA_DIR = dir;
    app = new Elysia().use(recoveryMetricsRoutes).use(providerCooldownsRoutes);
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('記録0件なら metrics:[] を 200 で返す', async () => {
    const res = await app.handle(new Request('http://localhost/agents/recovery-metrics'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as MetricsResponse;
    expect(body.metrics).toEqual([]);
    expect(body.windowDays).toBe(45);
    expect(body.minSamples).toBe(8);
    expect(typeof body.generatedAtMs).toBe('number');
  });

  it('混在レコードを (errorType × strategy) で正しく集計する', async () => {
    appendRecord(makeRecord({ outcome: 'success', costUsd: 0.1 }));
    appendRecord(makeRecord({ outcome: 'failure', costUsd: null, failureReason: 'rate_limit' }));
    appendRecord(makeRecord({ errorType: 'transient', strategy: 'none', outcome: 'no_candidate' }));

    const res = await app.handle(new Request('http://localhost/agents/recovery-metrics'));
    const body = (await res.json()) as MetricsResponse;

    expect(body.metrics).toHaveLength(2);
    const reroute = body.metrics.find((m) => m.strategy === 'reroute');
    expect(reroute).toMatchObject({
      errorType: 'quota',
      attempts: 2,
      successRate: 0.5,
      avgCostUsd: 0.1,
    });
    const none = body.metrics.find((m) => m.strategy === 'none');
    expect(none).toMatchObject({ errorType: 'transient', attempts: 1 });
  });

  it('?windowDays= が期間境界として効く（窓外レコードは集計されない）', async () => {
    appendRecord(makeRecord({ tsMs: Date.now() - 3 * DAY_MS }));

    const inWindow = (await (
      await app.handle(new Request('http://localhost/agents/recovery-metrics?windowDays=7'))
    ).json()) as MetricsResponse;
    expect(inWindow.windowDays).toBe(7);
    expect(inWindow.metrics).toHaveLength(1);

    const outOfWindow = (await (
      await app.handle(new Request('http://localhost/agents/recovery-metrics?windowDays=1'))
    ).json()) as MetricsResponse;
    expect(outOfWindow.windowDays).toBe(1);
    expect(outOfWindow.metrics).toEqual([]);
  });

  it('既存 GET /agents/cooldowns は互換のまま応答する', async () => {
    const res = await app.handle(new Request('http://localhost/agents/cooldowns'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { cooldowns: unknown[] };
    expect(Array.isArray(body.cooldowns)).toBe(true);
  });
});
