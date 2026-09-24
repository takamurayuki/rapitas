/**
 * outage-simulation-job tests — the periodic back-test job returns the
 * evaluated incident count, stays quiet without an inventory, and posts one
 * Slack summary per run.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';

const mockBuildSimulation = mock(() => ({ text: 'summary', blocks: [] }));
const mockSend = mock(() => Promise.resolve({ sent: false, reason: 'no_webhook' }));

// NOTE: bun's mock.module replaces the whole module — mirror every runtime export.
mock.module('../outage-slack-notifier', () => ({
  MAX_SLACK_PATHS: 10,
  VERDICT_LABELS: { safe: '停止安全', risk: 'リスク', danger: '危険' },
  buildOutageSlackPayload: mock(() => ({ text: '', blocks: [] })),
  buildSimulationSlackPayload: mockBuildSimulation,
  sendOutageSlack: mockSend,
  resolveSlackWebhookUrl: mock(() => Promise.resolve(null)),
}));

const { runOutageSimulationJob } = await import('../outage-simulation-job');
const { clearInventoryCache } = await import('../inventory-loader');

const FIXTURE = join(import.meta.dir, '__fixtures__', 'team-inventory.json');

describe('runOutageSimulationJob', () => {
  const prev = process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'outage-job-'));
    clearInventoryCache();
    mockBuildSimulation.mockClear();
    mockSend.mockClear();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
    else process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = prev;
  });

  test('returns 0 and sends nothing when the inventory is missing', async () => {
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = join(dir, 'missing.json');
    expect(await runOutageSimulationJob()).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns 0 without throwing when the inventory is invalid', async () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ version: 9 }));
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = file;
    expect(await runOutageSimulationJob()).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('evaluates the fixture, returns the incident count and posts one summary', async () => {
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = FIXTURE;
    const count = await runOutageSimulationJob();
    expect(count).toBe(51);
    expect(mockBuildSimulation).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [report] = mockBuildSimulation.mock.calls[0] as unknown as [{ status: string }];
    expect(report.status).toBe('passed');
  });
});
