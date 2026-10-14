/**
 * Canary ledger tests — stage constraint and promotion gate (acceptance criterion 4).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendCanaryHit } from './canary-event-log';
import type { CanaryFalsePositiveReview, CanaryHitRecord, CanaryStage } from './canary-types';
import {
  CanaryLedgerError,
  findToken,
  issueToken,
  loadLedger,
  promoteToProduction,
} from './canary-ledger';

let dir: string;
const prev = process.env.RAPITAS_DATA_DIR;

const review: CanaryFalsePositiveReview = {
  acknowledgedFalsePositiveReview: true,
  reviewer: 'ops',
  reviewedAt: '2026-10-13T00:00:00.000Z',
  isolatedHitCount: 4,
  falsePositiveCount: 1,
};

function seedHits(n: number, stage: CanaryStage = 'isolated') {
  for (let i = 0; i < n; i++) {
    const rec: CanaryHitRecord = {
      t: `2026-10-12T00:00:0${i}.000Z`,
      tokenId: 'seed',
      label: 'seed',
      ip: '203.0.113.1',
      forwardedFor: null,
      ua: 'seed',
      stage,
      trust: 'direct',
    };
    appendCanaryHit(rec);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canary-ledger-'));
  process.env.RAPITAS_DATA_DIR = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

describe('issueToken', () => {
  test('issues a random hex id, persists it and builds the URL', () => {
    const a = issueToken({ label: 'sandbox', placement: 'isolated' });
    const b = issueToken({ label: 'sandbox', placement: 'isolated' });
    expect(a.tokenId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.tokenId).not.toBe(b.tokenId);
    expect(a.url).toBe(`http://127.0.0.1:3001/canary/hit/${a.tokenId}`);
    expect(findToken(a.tokenId)?.label).toBe('sandbox');
    expect(loadLedger().tokens).toHaveLength(2);
  });

  test('defaults to the isolated stage', () => {
    expect(loadLedger().stage).toBe('isolated');
  });

  test('rejects a production placement while isolated', () => {
    expect(() => issueToken({ label: 'x', placement: 'production' })).toThrow(CanaryLedgerError);
    expect(loadLedger().tokens).toHaveLength(0);
  });

  test('rejects placement paths inside .worktrees', () => {
    expect(() =>
      issueToken({
        label: 'x',
        placement: 'isolated',
        placementPath: join(dir, '.worktrees', 't1'),
      }),
    ).toThrow(CanaryLedgerError);
  });

  test('uses the supplied baseUrl without a trailing slash', () => {
    const t = issueToken({ label: 'x', placement: 'isolated', baseUrl: 'https://c.example/' });
    expect(t.url).toBe(`https://c.example/canary/hit/${t.tokenId}`);
  });
});

describe('promoteToProduction', () => {
  test('refuses without a review', () => {
    expect(() => promoteToProduction(undefined as never)).toThrow(CanaryLedgerError);
    expect(loadLedger().stage).toBe('isolated');
  });

  test('refuses malformed review evidence', () => {
    expect(() => promoteToProduction({ ...review, reviewer: ' ' })).toThrow(CanaryLedgerError);
    expect(() => promoteToProduction({ ...review, reviewedAt: 'nope' })).toThrow(CanaryLedgerError);
    expect(() => promoteToProduction({ ...review, isolatedHitCount: -1 })).toThrow(
      CanaryLedgerError,
    );
    expect(() => promoteToProduction({ ...review, falsePositiveCount: 9 })).toThrow(
      CanaryLedgerError,
    );
    expect(loadLedger().stage).toBe('isolated');
  });

  test('refuses without the explicit acknowledgement flag', () => {
    seedHits(4);
    expect(() =>
      promoteToProduction({ ...review, acknowledgedFalsePositiveReview: false } as never),
    ).toThrow(CanaryLedgerError);
    expect(loadLedger().stage).toBe('isolated');
  });

  test('refuses a self-reported hit count that differs from the detection log', () => {
    seedHits(2);
    expect(() => promoteToProduction({ ...review, isolatedHitCount: 4 })).toThrow(
      CanaryLedgerError,
    );
    expect(loadLedger().stage).toBe('isolated');
  });

  test('does not count production-stage log lines as isolated evidence', () => {
    seedHits(4);
    seedHits(3, 'production');
    promoteToProduction(review);
    expect(loadLedger().stage).toBe('production');
  });

  test('promotes with a valid review, then allows production tokens', () => {
    seedHits(4);
    promoteToProduction(review);
    const ledger = loadLedger();
    expect(ledger.stage).toBe('production');
    expect(ledger.promotion?.reviewer).toBe('ops');
    expect(issueToken({ label: 'p', placement: 'production' }).placement).toBe('production');
  });
});
