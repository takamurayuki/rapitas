/**
 * Canary service tests — alert content, aggregation window and IP trust.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { handleCanaryHit, type CanaryNotifyParams } from './canary-service';
import { issueToken } from './canary-ledger';

let dir: string;
const prev = process.env.RAPITAS_DATA_DIR;
let calls: CanaryNotifyParams[];
const notify = async (p: CanaryNotifyParams) => {
  calls.push(p);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canary-svc-'));
  process.env.RAPITAS_DATA_DIR = dir;
  calls = [];
});
afterEach(() => {
  if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

function logLines(): Record<string, unknown>[] {
  const logs = join(dir, 'logs');
  if (!existsSync(logs)) return [];
  return readdirSync(logs)
    .filter((n) => n.startsWith('canary-'))
    .flatMap((n) => readFileSync(join(logs, n), 'utf8').trim().split('\n'))
    .map((l) => JSON.parse(l));
}

const at = (iso: string) => new Date(iso);

describe('handleCanaryHit', () => {
  test('matched hit logs and notifies with IP, time and UA', async () => {
    const tok = issueToken({ label: 'sandbox', placement: 'isolated' });
    const now = at('2026-10-13T10:00:00.000Z');
    const res = await handleCanaryHit(
      { tokenId: tok.tokenId, ip: '198.51.100.7', forwardedFor: null, ua: 'curl/8', now },
      { notify },
    );
    expect(res.matched).toBe(true);
    expect(res.notified).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.type).toBe('canary_triggered');
    expect(call.message).toContain('198.51.100.7');
    expect(call.message).toContain('curl/8');
    expect(call.message).toContain('2026-10-13T10:00:00.000Z');
    expect(call.metadata).toMatchObject({
      ip: '198.51.100.7',
      ua: 'curl/8',
      t: '2026-10-13T10:00:00.000Z',
      trust: 'direct',
    });
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ip: '198.51.100.7', ua: 'curl/8', tokenId: tok.tokenId });
  });

  test('unknown token produces no log and no notification', async () => {
    const res = await handleCanaryHit(
      { tokenId: 'f'.repeat(32), ip: '1.2.3.4', forwardedFor: null, ua: 'x', now: new Date() },
      { notify },
    );
    expect(res.matched).toBe(false);
    expect(calls).toHaveLength(0);
    expect(logLines()).toHaveLength(0);
  });

  test('hit inside the window is logged but not re-notified; after the window it notifies', async () => {
    const tok = issueToken({ label: 's', placement: 'isolated' });
    const hit = (iso: string) =>
      handleCanaryHit(
        { tokenId: tok.tokenId, ip: '1.1.1.1', forwardedFor: null, ua: 'u', now: at(iso) },
        { notify },
      );
    await hit('2026-10-13T10:00:00.000Z');
    const second = await hit('2026-10-13T10:02:00.000Z');
    expect(second.notified).toBe(false);
    expect(calls).toHaveLength(1);
    expect(logLines()).toHaveLength(2);
    await hit('2026-10-13T10:06:00.000Z');
    expect(calls).toHaveLength(2);
    expect(logLines()).toHaveLength(3);
  });

  test('forwarded header is recorded separately with trust=forwarded', async () => {
    const tok = issueToken({ label: 's', placement: 'isolated' });
    await handleCanaryHit(
      { tokenId: tok.tokenId, ip: '10.0.0.1', forwardedFor: '9.9.9.9', ua: 'u', now: new Date() },
      { notify },
    );
    expect(logLines()[0]).toMatchObject({
      ip: '10.0.0.1',
      forwardedFor: '9.9.9.9',
      trust: 'forwarded',
    });
  });

  test('missing UA and IP are recorded as null with trust=unknown and still alert', async () => {
    const tok = issueToken({ label: 's', placement: 'isolated' });
    await handleCanaryHit(
      { tokenId: tok.tokenId, ip: null, forwardedFor: null, ua: null, now: new Date() },
      { notify },
    );
    expect(logLines()[0]).toMatchObject({ ip: null, ua: null, trust: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  test('concurrent hits inside one window produce a single notification', async () => {
    const tok = issueToken({ label: 's', placement: 'isolated' });
    const slow = async (p: CanaryNotifyParams) => {
      calls.push(p);
      await new Promise((r) => setTimeout(r, 20));
    };
    const now = new Date('2026-10-13T10:00:00.000Z');
    const hit = () =>
      handleCanaryHit(
        { tokenId: tok.tokenId, ip: '1.1.1.1', forwardedFor: null, ua: 'u', now },
        { notify: slow },
      );
    const results = await Promise.all([hit(), hit(), hit()]);
    expect(calls).toHaveLength(1);
    expect(results.filter((r) => r.notified)).toHaveLength(1);
    expect(logLines()).toHaveLength(3);
  });

  test('a failed notification does not consume the window, so the next hit alerts', async () => {
    const tok = issueToken({ label: 's', placement: 'isolated' });
    const base = { tokenId: tok.tokenId, ip: '1.1.1.1', forwardedFor: null, ua: 'u' };
    const failed = await handleCanaryHit(
      { ...base, now: new Date('2026-10-13T10:00:00.000Z') },
      {
        notify: async () => {
          throw new Error('db down');
        },
      },
    );
    expect(failed.notified).toBe(false);
    const retry = await handleCanaryHit(
      { ...base, now: new Date('2026-10-13T10:00:30.000Z') },
      { notify },
    );
    expect(retry.notified).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('a failing notifier does not prevent the log write nor throw', async () => {
    const tok = issueToken({ label: 's', placement: 'isolated' });
    const res = await handleCanaryHit(
      { tokenId: tok.tokenId, ip: '1.1.1.1', forwardedFor: null, ua: 'u', now: new Date() },
      {
        notify: async () => {
          throw new Error('db down');
        },
      },
    );
    expect(res.matched).toBe(true);
    expect(res.notified).toBe(false);
    expect(logLines()).toHaveLength(1);
  });
});
