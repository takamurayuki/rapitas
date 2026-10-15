/**
 * question-auto-answer-override-gate.test
 *
 * 無応答タイムアウトの自動採用は、人間の明示承認しか解除できないゲート
 * (schema-change) が失敗しているタスクには適用してはならない(task 1103)。
 * 採用しても次の検証で同じ失敗を繰り返すだけで、差し戻しループになる。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

type Job = {
  status: string;
  checks?: { name: string; ok: boolean }[];
} | null;

let job: Job = null;
let throws = false;
const getLatestJobMock = mock(() => {
  if (throws) return Promise.reject(new Error('timeline unreadable'));
  return Promise.resolve(job);
});

mock.module('./verification-job-store', () => ({
  getLatestJob: getLatestJobMock,
  getJobByRunId: mock(() => Promise.resolve(null)),
  recordJobStart: mock(() => Promise.resolve()),
  recordJobFinish: mock(() => Promise.resolve()),
}));

const { resolveHumanOverrideHold } = await import('./question-auto-answer-override-gate');

beforeEach(() => {
  job = null;
  throws = false;
  getLatestJobMock.mockClear();
});

describe('resolveHumanOverrideHold', () => {
  test('holds when the latest verification failed schema-change', async () => {
    job = {
      status: 'completed',
      checks: [
        { name: 'test', ok: true },
        { name: 'schema-change', ok: false },
      ],
    };
    expect(await resolveHumanOverrideHold(1103)).toEqual({ hold: true, check: 'schema-change' });
  });

  test.each([
    [
      'schema-change passed',
      { status: 'completed', checks: [{ name: 'schema-change', ok: true }] },
    ],
    [
      'only other checks failed — those an answer can still fix',
      {
        status: 'completed',
        checks: [
          { name: 'scope', ok: false },
          { name: 'test', ok: false },
        ],
      },
    ],
    ['there is no verification history', null],
    ['the job is still running, so its checks are not final', { status: 'running' }],
  ] as [string, Job][])('does not hold when %s', async (_label, given) => {
    job = given;
    expect(await resolveHumanOverrideHold(1103)).toEqual({ hold: false });
  });

  test('fails open when the verification history cannot be read', async () => {
    throws = true;
    expect(await resolveHumanOverrideHold(1103)).toEqual({ hold: false });
  });
});
