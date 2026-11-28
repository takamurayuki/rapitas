/**
 * performAutoCommitAndPR — verification stop record
 *
 * Every path that returns `verificationBlocked` leaves exactly one transition
 * naming the stage and the failed checks, whatever the caller does next.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  cleanPreSave,
  gateMock,
  handleVerifyGateBlocked,
  passedGuard,
  passingGate,
  performAutoCommitAndPR,
  state,
} from './workflow-auto-commit.stop-record.fixture';

type Gate = import('../../services/agents/verification/verification-gate').GateOutcome;

const stops = () => state.rows.filter((r) => r.cause === 'verification_stopped');
const metadata = () => {
  expect(stops()).toHaveLength(1);
  return JSON.parse(stops()[0].metadata) as {
    stage: string;
    summary: string;
    reason: string;
    failedChecks: string[];
    details: Array<{ name: string; details: string }>;
  };
};

const failedGate = (
  checks: Array<{ name: string; ok: boolean; unverifiable?: boolean; details?: string }>,
  extra: { unverifiable?: boolean; summary?: string } = {},
): Gate =>
  ({
    ok: false,
    verdict: 'fail',
    result: {
      ok: false,
      summary: extra.summary ?? 'scope=NG(1) / runtime=NG(1)',
      unverifiable: extra.unverifiable,
      checks,
      changedFiles: [],
    },
  }) as unknown as Gate;

beforeEach(() => {
  state.rows.length = 0;
  state.writeFails = false;
  state.holdRowExists = false;
  state.preSave = cleanPreSave;
  state.repair = { bounced: false };
  state.guard = { ...passedGuard, ok: false, error: 'dirty tree' };
  gateMock.mockReset();
  gateMock.mockImplementation(async () => passingGate);
});

describe('pre-save stop', () => {
  test('names the failed tamper and secret checks, without the advisory scope', async () => {
    state.preSave = {
      ok: false,
      summary: 'tamper=NG(1) / secret=NG(1) / attribution=ok / scope=NG(2)',
      tamper: { name: 'tamper', ok: false, details: 'protected file changed' },
      secrets: ['.env'],
      unattributed: [],
    };

    const out = await performAutoCommitAndPR(1, 'PASS');

    expect(metadata()).toMatchObject({
      stage: 'pre_save',
      summary: state.preSave.summary,
      reason: out.error,
      failedChecks: ['tamper', 'secret'],
      details: [
        { name: 'tamper', details: 'protected file changed' },
        { name: 'secret', details: '.env' },
      ],
    });
    expect(stops()[0]).toMatchObject({
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      phase: 'verify',
    });
  });

  test('names an attribution failure', async () => {
    state.preSave = { ...cleanPreSave, ok: false, unattributed: ['src/a.ts'] };

    await performAutoCommitAndPR(1, 'PASS');

    expect(metadata().failedChecks).toEqual(['attribution']);
  });
});

describe('post-commit gate stop', () => {
  test('names every failing check and truncates long details', async () => {
    gateMock.mockImplementation(async () =>
      failedGate([
        { name: 'lint', ok: true },
        { name: 'scope', ok: false, details: 'x'.repeat(5000) },
        { name: 'runtime', ok: false },
      ]),
    );

    const out = await performAutoCommitAndPR(1, 'PASS');

    const meta = metadata();
    expect(meta).toMatchObject({
      stage: 'post_commit_gate',
      summary: 'scope=NG(1) / runtime=NG(1)',
      reason: out.error,
      failedChecks: ['scope', 'runtime'],
    });
    expect(meta.details[0].details).toHaveLength(2000);
    expect(meta.details[1].details).toBe('');
  });

  test('records a verifier crash that produced no check evidence', async () => {
    gateMock.mockImplementation(async () => failedGate([], { unverifiable: true }));

    await performAutoCommitAndPR(1, 'PASS');

    expect(metadata().failedChecks).toEqual(['verifier']);
  });

  test('records a verifier that returned no result at all', async () => {
    gateMock.mockImplementation(async () => ({ ok: false, result: null, verdict: 'fail' }));

    await performAutoCommitAndPR(1, 'PASS');

    expect(metadata().failedChecks).toEqual(['verifier']);
  });

  test('adds nothing when the gate already recorded an unverifiable hold', async () => {
    gateMock.mockImplementation(async () =>
      failedGate([{ name: 'runtime', ok: false, unverifiable: true }], { unverifiable: true }),
    );

    const out = await performAutoCommitAndPR(1, 'PASS');

    expect(out.verificationBlocked).toBe(true);
    expect(stops()).toHaveLength(0);
  });

  test('records nothing when the gate passes', async () => {
    state.guard = passedGuard;

    await performAutoCommitAndPR(1, 'PASS');

    expect(stops()).toHaveLength(0);
  });

  test('a failed write never changes the outcome', async () => {
    state.writeFails = true;
    gateMock.mockImplementation(async () => failedGate([{ name: 'lint', ok: false }]));

    const out = await performAutoCommitAndPR(1, 'PASS');

    expect(out.verificationBlocked).toBe(true);
    expect(out.error).toContain('自動検証に失敗');
  });
});

describe('publish guard stop', () => {
  const reverifyFailed = {
    ...passedGuard,
    ok: false,
    verdict: 'fail',
    verificationBlocked: true,
    error: 're-verification failed',
  };

  test('records the re-verification failure', async () => {
    state.guard = reverifyFailed;

    await performAutoCommitAndPR(1, 'PASS');

    expect(metadata()).toMatchObject({
      stage: 'publish_guard',
      reason: 're-verification failed',
      failedChecks: ['reverify'],
    });
  });

  test('adds nothing when the re-run already recorded an unverifiable hold', async () => {
    state.guard = { ...reverifyFailed, verificationUnverifiable: true };
    state.holdRowExists = true;

    await performAutoCommitAndPR(1, 'PASS');

    expect(stops()).toHaveLength(0);
  });

  test('records an unverifiable re-run that left no hold (verifier crash)', async () => {
    state.guard = { ...reverifyFailed, verificationUnverifiable: true };

    await performAutoCommitAndPR(1, 'PASS');

    expect(stops()).toHaveLength(1);
  });

  test('a withheld publish that is not a verification stop records nothing', async () => {
    await performAutoCommitAndPR(1, 'PASS');

    expect(stops()).toHaveLength(0);
  });
});

describe('the HTTP caller cannot lose the record', () => {
  for (const [name, outcome] of [
    ['stale', { bounced: false, stale: true }],
    ['exhausted', { bounced: false }],
  ] as const) {
    test(`keeps one stop row when the self-repair is ${name}`, async () => {
      gateMock.mockImplementation(async () => failedGate([{ name: 'runtime', ok: false }]));
      state.repair = outcome;

      const out = await performAutoCommitAndPR(1, 'PASS');
      await handleVerifyGateBlocked({
        taskId: 1,
        gateReason: out.error!,
        gateRecoveryBlocked: null,
        savedContent: 'PASS',
      });

      expect(metadata().failedChecks).toEqual(['runtime']);
    });
  }
});
