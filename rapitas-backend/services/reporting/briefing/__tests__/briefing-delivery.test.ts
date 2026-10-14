/**
 * briefing-delivery.test
 *
 * Delivery tests: count-only lock-screen text, text fallback on failure,
 * idempotency (acceptance criteria 3, 4).
 */
import { describe, it, expect, mock } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, existsSync } from 'fs';
import { deliverBriefing, buildCountOnlyMessage } from '../briefing-delivery';
import type { BriefingInput } from '../briefing-types';

const input: BriefingInput = {
  date: '2026-10-14',
  completed: [{ id: 1, title: '極秘タスク名', prNumber: null }],
  held: [{ id: 2, title: '保留の秘密', reason: '秘密の理由' }],
  decisionCandidates: [
    {
      id: 2,
      title: '保留の秘密',
      priority: 'high',
      dueDate: null,
      blockingCount: 0,
      reason: '秘密の理由',
      options: ['再開', '破棄'],
    },
  ],
  linkUrl: '/agents/daily-report?date=2026-10-14',
};

const mkDeps = (tts: { synthesize: (t: string) => Promise<Uint8Array | null> } | null = null) => ({
  dataDir: mkdtempSync(join(tmpdir(), 'briefing-')),
  notify: mock(async (_p: { title: string; message: string; link?: string }) => {}),
  fallbackNotify: mock(async (_message: string) => {}),
  tts,
});

describe('buildCountOnlyMessage', () => {
  it('contains counts only', () => {
    const m = buildCountOnlyMessage(1, 1, 1);
    expect(m).toMatch(/1/);
    expect(m).not.toContain('秘密');
  });
});

describe('deliverBriefing', () => {
  it('sends a count-only notification when audio is produced', async () => {
    const deps = mkDeps({ synthesize: async () => new Uint8Array([1, 2, 3]) });
    const r = await deliverBriefing(input, deps);
    expect(r.status).toBe('delivered');
    expect(deps.notify).toHaveBeenCalledTimes(1);
    const arg = JSON.stringify(deps.notify.mock.calls[0]);
    expect(arg).not.toContain('極秘タスク名');
    expect(arg).not.toContain('秘密の理由');
    expect(deps.fallbackNotify).not.toHaveBeenCalled();
  });
  it('falls back to exactly one text notification when TTS throws', async () => {
    const deps = mkDeps({
      synthesize: async () => {
        throw new Error('boom');
      },
    });
    const r = await deliverBriefing(input, deps);
    expect(r.status).toBe('fallback');
    expect(deps.fallbackNotify).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();
  });
  it('is script-only without TTS and adds no notification', async () => {
    const deps = mkDeps();
    const r = await deliverBriefing(input, deps);
    expect(r.status).toBe('script_only');
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.fallbackNotify).not.toHaveBeenCalled();
    expect(existsSync(join(deps.dataDir, 'briefings', '2026-10-14.json'))).toBe(true);
  });
  it('is idempotent per date', async () => {
    const deps = mkDeps({ synthesize: async () => new Uint8Array([1]) });
    await deliverBriefing(input, deps);
    const r2 = await deliverBriefing(input, deps);
    expect(r2.status).toBe('skipped');
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});

describe('real-length loop', () => {
  const big: BriefingInput = {
    ...input,
    completed: Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      title: `タスク${i}`,
      prNumber: null,
    })),
  };
  const audioOf = (seconds: number) => ({
    data: new Uint8Array([1]),
    mime: 'audio/wav',
    seconds,
  });

  it('resynthesizes with a smaller script when real audio exceeds 180s', async () => {
    const seq = [200, 170];
    const lens: number[] = [];
    const deps = mkDeps({
      synthesize: async (t: string) => {
        lens.push([...t].length);
        return audioOf(seq.shift()!);
      },
    });
    const r = await deliverBriefing(big, deps);
    expect(r.status).toBe('delivered');
    expect(lens.length).toBe(2);
    expect(lens[1]).toBeLessThan(lens[0]);
    const meta = (deps.notify.mock.calls[0] as unknown[])[0] as {
      metadata?: { briefing?: { audioSeconds?: number; audioMime?: string } };
    };
    expect(meta.metadata?.briefing?.audioSeconds).toBe(170);
    expect(meta.metadata?.briefing?.audioMime).toBe('audio/wav');
  });
  it('gives up after 5 attempts and falls back to text', async () => {
    let calls = 0;
    const deps = mkDeps({
      synthesize: async () => {
        calls++;
        return audioOf(200);
      },
    });
    const r = await deliverBriefing(big, deps);
    expect(calls).toBe(5);
    expect(r.status).toBe('fallback');
    expect(deps.fallbackNotify).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
