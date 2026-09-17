/**
 * repair-risk.routes.test
 *
 * Route-level tests via Elysia handle(): default window, explicit window,
 * 400 on invalid windows, 500 on aggregation failure. The effectiveness
 * service is stubbed via mock.module (process-global — run in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const cohort = {
  sampleSize: 8,
  lowSample: false,
  repairRate: 0.25,
  mttrMinutes: 12,
  mttrSampleSize: 2,
};
const computeMock = mock((windowDays: number) =>
  Promise.resolve({
    windowDays,
    fired: cohort,
    notFired: { ...cohort, repairRate: 0.5 },
    delta: { repairRateDelta: -0.25, mttrMinutesDelta: 0 },
  }),
);
mock.module('../../services/self-improvement/repair-risk-effectiveness', () => ({
  computeRepairRiskEffectiveness: computeMock,
  compareCohorts: mock(() => ({})),
  summarizeCohort: mock(() => ({})),
  taskMttrMinutes: mock(() => null),
}));

const { default: repairRiskRoutes } = await import('./repair-risk.routes');

const BASE = 'http://localhost/self-improvement/repair-risk/effectiveness';

describe('GET /self-improvement/repair-risk/effectiveness', () => {
  beforeEach(() => {
    computeMock.mockClear();
    delete process.env.RAPITAS_REPAIR_RISK_WINDOW_DAYS;
  });

  it('既定90日で fired/notFired/delta を返す', async () => {
    const res = await repairRiskRoutes.handle(new Request(BASE));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(computeMock).toHaveBeenCalledWith(90);
    expect(body).toMatchObject({
      success: true,
      windowDays: 90,
      delta: { repairRateDelta: -0.25, mttrMinutesDelta: 0 },
    });
    expect(body.fired).toBeDefined();
    expect(body.notFired).toBeDefined();
  });

  it('windowDays クエリを渡せる', async () => {
    const res = await repairRiskRoutes.handle(new Request(`${BASE}?windowDays=30`));
    expect(res.status).toBe(200);
    expect(computeMock).toHaveBeenCalledWith(30);
  });

  it.each(['0', '-1', 'abc', '366'])('不正な windowDays=%s は 400', async (w) => {
    const res = await repairRiskRoutes.handle(new Request(`${BASE}?windowDays=${w}`));
    expect(res.status).toBe(400);
    expect(computeMock).not.toHaveBeenCalled();
  });

  it('集計失敗は 500', async () => {
    computeMock.mockRejectedValueOnce(new Error('db down'));
    const res = await repairRiskRoutes.handle(new Request(BASE));
    expect(res.status).toBe(500);
  });
});
