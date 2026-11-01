/**
 * verification-gate.unverifiable-hold.test
 *
 * Blocking on a check that could not run records the structured hold reason
 * (verification_unverifiable_hold) the blocked-task passes key on; a normal
 * failure or a verifier crash records nothing extra.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => {
  const noop = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} };
  return { createLogger: () => noop, logger: noop, getBackendLogFilePath: () => '/tmp/b.log' };
});
const blockedWrites: number[] = [];
mock.module('../../workflow/durable-blocked-write', () => ({
  writeBlockedStatusDurable: (o: { taskId: number }) => {
    blockedWrites.push(o.taskId);
    return Promise.resolve(true);
  },
}));
const recorded: Array<Record<string, unknown>> = [];
mock.module('../../workflow/transition-recorder', () => ({
  recordTransition: (t: Record<string, unknown>) => {
    recorded.push(t);
    return Promise.resolve();
  },
}));

const { blockTaskForVerification, verificationCrashResult } = await import('./verification-gate');

beforeEach(() => {
  blockedWrites.length = 0;
  recorded.length = 0;
});

const check = (name: 'runtime' | 'lint', ok: boolean, unverifiable?: boolean) => ({
  name,
  ran: !unverifiable,
  ok,
  unverifiable,
  errorCount: ok ? 0 : 1,
  details: '',
});

test('an unverifiable check records the structured hold with the check names', async () => {
  await blockTaskForVerification(912, {
    ok: false,
    unverifiable: true,
    changedFiles: [],
    summary: 'runtime=UNVERIFIED',
    checks: [check('lint', true), check('runtime', false, true)],
  });
  expect(blockedWrites).toEqual([912]);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    taskId: 912,
    toStatus: 'blocked',
    cause: 'verification_unverifiable_hold',
    metadata: { summary: 'runtime=UNVERIFIED', unverifiableChecks: ['runtime'] },
  });
});

test('a normal gate failure records no hold (stays eligible for repair/retry)', async () => {
  await blockTaskForVerification(912, {
    ok: false,
    changedFiles: [],
    summary: 'lint=NG(1)',
    checks: [check('lint', false)],
  });
  expect(blockedWrites).toEqual([912]);
  expect(recorded).toHaveLength(0);
});

test('a verifier crash (no check evidence) stays retryable: no hold recorded', async () => {
  const crash = verificationCrashResult();
  // task 1099: a crash is always 'fail', never 'unknown' — it must not be
  // mistaken for a merely-indeterminate result that permits a draft PR.
  expect(crash.verdict).toBe('fail');
  await blockTaskForVerification(912, crash);
  expect(blockedWrites).toEqual([912]);
  expect(recorded).toHaveLength(0);
});

// 実測 2026-10-18 (#1058): 保存されるのが名前だけだったため、11 件のタスクが
// 「runtime=UNVERIFIED」とだけ書かれて滞留し、実際の原因(pnpm が起動を拒否)は
// どこにも残らなかった。details には起動ログ末尾まで既に入っている。
test('the hold carries each unverifiable check s details, not just its name', async () => {
  const launchLog =
    'Error: ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH\n  x Refusing to use task run state directory';
  await blockTaskForVerification(912, {
    ok: false,
    unverifiable: true,
    changedFiles: [],
    summary: 'runtime=UNVERIFIED',
    checks: [
      { ...check('lint', true), details: 'lint: ok' },
      { ...check('runtime', false, true), details: launchLog },
    ],
  });
  const md = recorded[0].metadata as {
    unverifiableDetails: { name: string; details: string }[];
  };
  expect(md.unverifiableDetails).toEqual([{ name: 'runtime', details: launchLog }]);
});

// 起動ログ末尾は長さが読めない。この行は UI も読むので上限を置く。
test('long details are truncated so one launch log cannot bloat the row', async () => {
  await blockTaskForVerification(912, {
    ok: false,
    unverifiable: true,
    changedFiles: [],
    summary: 'runtime=UNVERIFIED',
    checks: [{ ...check('runtime', false, true), details: 'x'.repeat(5000) }],
  });
  const md = recorded[0].metadata as {
    unverifiableDetails: { name: string; details: string }[];
  };
  expect(md.unverifiableDetails[0].details.length).toBe(2000);
});
