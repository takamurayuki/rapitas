/**
 * outage-slack-notifier tests — Block Kit content (verdict label + evidence
 * paths), path truncation, and never-throw sending semantics.
 */
import { describe, test, expect, spyOn } from 'bun:test';
import {
  buildOutageSlackPayload,
  buildSimulationSlackPayload,
  sendOutageSlack,
  MAX_SLACK_PATHS,
} from '../outage-slack-notifier';
import type { OutageAssessment, SimulationReport } from '../outage-guidance.types';

function assessment(overrides: Partial<OutageAssessment> = {}): OutageAssessment {
  return {
    targetServiceId: 'orders-db',
    verdict: 'danger',
    estimatedRecoveryMinutes: 40,
    toleranceMinutes: 15,
    historySamples: 4,
    blastRatio: 0.357,
    affected: [
      { serviceId: 'order-api', depth: 1, path: ['order-api', 'orders-db'] },
      {
        serviceId: 'gateway',
        depth: 3,
        path: ['gateway', 'checkout-api', 'order-api', 'orders-db'],
      },
    ],
    reasons: ['recovery_exceeds_tolerance'],
    computedInMs: 0.2,
    ...overrides,
  };
}

const NAMES = {
  'orders-db': 'Orders DB',
  'order-api': 'Order API',
  'checkout-api': 'Checkout API',
  gateway: 'API Gateway',
};

function allText(payload: { text: string; blocks: Array<{ text: { text: string } }> }): string {
  return [payload.text, ...payload.blocks.map((b) => b.text.text)].join('\n');
}

describe('buildOutageSlackPayload', () => {
  test('includes the verdict label, service name and arrow-joined evidence paths', () => {
    const p = buildOutageSlackPayload(assessment(), NAMES);
    const text = allText(p);
    expect(p.blocks).toHaveLength(3);
    expect(text).toContain('危険');
    expect(text).toContain('Orders DB');
    expect(text).toContain(
      'API Gateway(gateway) → Checkout API(checkout-api) → Order API(order-api) → Orders DB(orders-db)',
    );
    expect(text).toContain('40');
    expect(text).toContain('15');
  });

  test('uses 停止安全 / リスク labels for the other verdicts', () => {
    expect(allText(buildOutageSlackPayload(assessment({ verdict: 'safe' }), NAMES))).toContain(
      '停止安全',
    );
    expect(allText(buildOutageSlackPayload(assessment({ verdict: 'risk' }), NAMES))).toContain(
      'リスク',
    );
  });

  test('caps the number of paths and reports the remainder', () => {
    const affected = Array.from({ length: MAX_SLACK_PATHS + 1 }, (_, i) => ({
      serviceId: `svc-${i}`,
      depth: 1,
      path: [`svc-${i}`, 'orders-db'],
    }));
    const text = allText(buildOutageSlackPayload(assessment({ affected }), NAMES));
    expect(text).toContain('…他 1 件');
    expect(text).not.toContain(`svc-${MAX_SLACK_PATHS}(`);
  });

  test('isolated target states there is no dependent path', () => {
    const text = allText(buildOutageSlackPayload(assessment({ affected: [] }), NAMES));
    expect(text).toContain('影響を受ける依存サービスはありません');
  });

  test('keeps every block under the Slack section limit', () => {
    const longName = 'x'.repeat(400);
    const affected = Array.from({ length: 10 }, (_, i) => ({
      serviceId: `s${i}`,
      depth: 1,
      path: [`s${i}`, 'orders-db'],
    }));
    const names = Object.fromEntries(affected.map((a) => [a.serviceId, longName]));
    const p = buildOutageSlackPayload(assessment({ affected }), names);
    for (const b of p.blocks) expect(b.text.text.length).toBeLessThanOrEqual(2900);
  });
});

describe('buildSimulationSlackPayload', () => {
  test('summarizes accuracy and status', () => {
    const report: SimulationReport = {
      total: 20,
      correct: 19,
      accuracy: 0.95,
      threshold: 0.9,
      status: 'passed',
      confusion: {
        safe: { safe: 5, risk: 1, danger: 0 },
        risk: { safe: 0, risk: 7, danger: 0 },
        danger: { safe: 0, risk: 0, danger: 7 },
      },
      mismatches: [{ incidentId: 'inc-1', expected: 'safe', predicted: 'risk' }],
      evaluatedAt: '2026-09-24T00:00:00.000Z',
    };
    const text = allText(buildSimulationSlackPayload(report, 'payments'));
    expect(text).toContain('95.0%');
    expect(text).toContain('inc-1');
    expect(text).toContain('payments');
  });
});

describe('sendOutageSlack', () => {
  test('without a webhook it skips fetch and returns no_webhook', async () => {
    const spy = spyOn(globalThis, 'fetch');
    const res = await sendOutageSlack(buildOutageSlackPayload(assessment(), NAMES), {
      webhookUrl: null,
    });
    expect(res).toEqual({ sent: false, reason: 'no_webhook' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('posts the payload and reports success', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const payload = buildOutageSlackPayload(assessment(), NAMES);
    const res = await sendOutageSlack(payload, { webhookUrl: 'https://hooks.example.test/x' });
    expect(res).toEqual({ sent: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(payload);
    spy.mockRestore();
  });

  test('HTTP error is reported as http_<status>', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 404 }));
    const res = await sendOutageSlack(buildOutageSlackPayload(assessment(), NAMES), {
      webhookUrl: 'https://hooks.example.test/x',
    });
    expect(res).toEqual({ sent: false, reason: 'http_404' });
    spy.mockRestore();
  });

  test('network failure never throws', async () => {
    const spy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await sendOutageSlack(buildOutageSlackPayload(assessment(), NAMES), {
      webhookUrl: 'https://hooks.example.test/x',
    });
    expect(res).toEqual({ sent: false, reason: 'network_error' });
    spy.mockRestore();
  });

  test('env webhook takes precedence when no explicit url is given', async () => {
    const prev = process.env.RAPITAS_OUTAGE_SLACK_WEBHOOK_URL;
    process.env.RAPITAS_OUTAGE_SLACK_WEBHOOK_URL = 'https://hooks.example.test/env';
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const res = await sendOutageSlack(buildOutageSlackPayload(assessment(), NAMES));
    expect(res.sent).toBe(true);
    expect(spy.mock.calls[0][0]).toBe('https://hooks.example.test/env');
    spy.mockRestore();
    if (prev === undefined) delete process.env.RAPITAS_OUTAGE_SLACK_WEBHOOK_URL;
    else process.env.RAPITAS_OUTAGE_SLACK_WEBHOOK_URL = prev;
  });
});
