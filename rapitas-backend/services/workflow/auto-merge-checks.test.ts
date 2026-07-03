/**
 * auto-merge-checks.test
 *
 * Coverage for the pure aggregate-state evaluator (evaluateAutoMergeChecks),
 * the env-overridable blocking-check set (blockingChecks), and the three
 * `gh` CLI readers (readPrChecks / readMergeState / readHeadSha) including
 * their tolerant handling of gh's non-zero exit on red/pending/no-CI PRs.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mutable state driving the mocked exec's callback per test.
let execBehavior: (cmd: string) => { stdout: string; stderr: string } | Error = () => ({
  stdout: '[]',
  stderr: '',
});

const execMock = mock(
  (
    cmd: string,
    _optsOrCb: unknown,
    cb?: (
      err: (Error & { stdout?: string; stderr?: string }) | null,
      result?: { stdout: string; stderr: string },
    ) => void,
  ) => {
    // promisify(exec) calls exec(cmd, options, callback).
    const callback = (typeof _optsOrCb === 'function' ? _optsOrCb : cb) as (
      err: (Error & { stdout?: string; stderr?: string }) | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    const result = execBehavior(cmd);
    if (result instanceof Error) {
      callback(result as Error & { stdout?: string; stderr?: string });
    } else {
      callback(null, result);
    }
  },
);

// NOTE: Mirror ALL child_process exports under both specifiers — bun
// mock.module is process-global; any other file in this test run importing
// child_process/node:child_process would break if exec/execFile is missing.
mock.module('child_process', () => ({ exec: execMock, execFile: mock(() => {}) }));
mock.module('node:child_process', () => ({ exec: execMock, execFile: mock(() => {}) }));

const logWarn = mock(() => {});
const logDebug = mock(() => {});
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: logWarn,
    error: mock(() => {}),
    debug: logDebug,
  }),
}));

const { blockingChecks, evaluateAutoMergeChecks, readPrChecks, readMergeState, readHeadSha } =
  await import('./auto-merge-checks');

beforeEach(() => {
  execMock.mockClear();
  logWarn.mockClear();
  logDebug.mockClear();
  execBehavior = () => ({ stdout: '[]', stderr: '' });
  delete process.env.RAPITAS_AUTOMERGE_CHECKS;
});

describe('blockingChecks', () => {
  it('returns the hardcoded default set when the env var is unset', () => {
    const set = blockingChecks();
    expect(set.has('Test Backend')).toBe(true);
    expect(set.has('Lint Code')).toBe(true);
    expect(set.has('Quick Build Check')).toBe(true);
  });

  it('parses a comma-separated RAPITAS_AUTOMERGE_CHECKS override', () => {
    process.env.RAPITAS_AUTOMERGE_CHECKS = 'Foo, Bar,Baz';
    const set = blockingChecks();
    expect(set).toEqual(new Set(['Foo', 'Bar', 'Baz']));
  });

  it('trims whitespace and drops empty entries from the override', () => {
    process.env.RAPITAS_AUTOMERGE_CHECKS = ' Foo ,, Bar ,  ';
    const set = blockingChecks();
    expect(set).toEqual(new Set(['Foo', 'Bar']));
  });

  it('an override of only whitespace/commas yields an empty set (not the default)', () => {
    process.env.RAPITAS_AUTOMERGE_CHECKS = ' , , ';
    const set = blockingChecks();
    expect(set.size).toBe(0);
  });
});

describe('evaluateAutoMergeChecks', () => {
  const blocking = new Set(['Test Backend', 'Lint Code']);

  it('returns "unknown" when none of the blocking checks are present', () => {
    const result = evaluateAutoMergeChecks([{ name: 'Bundle Size', bucket: 'pass' }], blocking);
    expect(result).toBe('unknown');
  });

  it('returns "unknown" for an empty checks array', () => {
    expect(evaluateAutoMergeChecks([], blocking)).toBe('unknown');
  });

  it('returns "pass" when every relevant blocking check passed', () => {
    const result = evaluateAutoMergeChecks(
      [
        { name: 'Test Backend', bucket: 'pass' },
        { name: 'Lint Code', bucket: 'pass' },
        { name: 'Bundle Size', bucket: 'fail' }, // advisory, ignored
      ],
      blocking,
    );
    expect(result).toBe('pass');
  });

  it('treats a "skipping" bucket as passing (not a failure)', () => {
    const result = evaluateAutoMergeChecks(
      [{ name: 'Test Backend', bucket: 'skipping' }],
      blocking,
    );
    expect(result).toBe('pass');
  });

  it('returns "fail" when any relevant blocking check failed', () => {
    const result = evaluateAutoMergeChecks(
      [
        { name: 'Test Backend', bucket: 'fail' },
        { name: 'Lint Code', bucket: 'pending' },
      ],
      blocking,
    );
    expect(result).toBe('fail');
  });

  it('returns "fail" when any relevant blocking check was cancelled', () => {
    const result = evaluateAutoMergeChecks([{ name: 'Test Backend', bucket: 'cancel' }], blocking);
    expect(result).toBe('fail');
  });

  it('fail takes precedence over pending when both are present', () => {
    const result = evaluateAutoMergeChecks(
      [
        { name: 'Test Backend', bucket: 'pending' },
        { name: 'Lint Code', bucket: 'fail' },
      ],
      blocking,
    );
    expect(result).toBe('fail');
  });

  it('returns "pending" when a blocking check is still running and none failed', () => {
    const result = evaluateAutoMergeChecks(
      [
        { name: 'Test Backend', bucket: 'pass' },
        { name: 'Lint Code', bucket: 'pending' },
      ],
      blocking,
    );
    expect(result).toBe('pending');
  });
});

describe('readPrChecks', () => {
  it('parses the checks JSON on a clean success', async () => {
    execBehavior = () => ({ stdout: '[{"name":"Test Backend","bucket":"pass"}]', stderr: '' });

    const result = await readPrChecks('/repo', 42);

    expect(result).toEqual([{ name: 'Test Backend', bucket: 'pass' }]);
    expect(execMock.mock.calls[0][0]).toContain('42');
  });

  it('recovers checks from a non-zero exit that still printed JSON to stdout', async () => {
    const err = Object.assign(new Error('gh exited 1'), {
      stdout: '[{"name":"Lint Code","bucket":"fail"}]',
      stderr: '',
    });
    execBehavior = () => err;

    const result = await readPrChecks('/repo', 42);

    expect(result).toEqual([{ name: 'Lint Code', bucket: 'fail' }]);
  });

  it('returns [] when gh reports "no checks reported" (no CI on branch), no stdout', async () => {
    const err = Object.assign(new Error('gh exited 1'), {
      stderr: "no checks reported on the 'x' branch",
    });
    execBehavior = () => err;

    const result = await readPrChecks('/repo', 42);

    expect(result).toEqual([]);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('falls through to the no-checks-reported stderr check when stdout is unparsable JSON', async () => {
    const err = Object.assign(new Error('gh exited 1'), {
      stdout: 'not json',
      stderr: 'no checks reported on this branch',
    });
    execBehavior = () => err;

    const result = await readPrChecks('/repo', 42);

    expect(result).toEqual([]);
  });

  it('returns null and warns on an unrecognized transient gh failure', async () => {
    const err = Object.assign(new Error('network error'), { stderr: 'connection reset' });
    execBehavior = () => err;

    const result = await readPrChecks('/repo', 42);

    expect(result).toBeNull();
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('returns null when neither stdout nor a recognizable stderr is present', async () => {
    const err = new Error('unknown failure');
    execBehavior = () => err;

    const result = await readPrChecks('/repo', 42);

    expect(result).toBeNull();
  });
});

describe('readMergeState', () => {
  it('returns the mergeStateStatus on success', async () => {
    execBehavior = () => ({ stdout: '{"mergeStateStatus":"CLEAN"}', stderr: '' });

    expect(await readMergeState('/repo', 42)).toBe('CLEAN');
  });

  it('returns null when the field is absent from the response', async () => {
    execBehavior = () => ({ stdout: '{}', stderr: '' });

    expect(await readMergeState('/repo', 42)).toBeNull();
  });

  it('returns null and warns on a gh failure', async () => {
    execBehavior = () => Object.assign(new Error('gh failed'), { stderr: 'boom' });

    expect(await readMergeState('/repo', 42)).toBeNull();
    expect(logWarn).toHaveBeenCalledTimes(1);
  });
});

describe('readHeadSha', () => {
  it('returns the headRefOid on success', async () => {
    execBehavior = () => ({ stdout: '{"headRefOid":"abc123"}', stderr: '' });

    expect(await readHeadSha('/repo', 42)).toBe('abc123');
  });

  it('returns null when the field is absent from the response', async () => {
    execBehavior = () => ({ stdout: '{}', stderr: '' });

    expect(await readHeadSha('/repo', 42)).toBeNull();
  });

  it('returns null and warns on a gh failure', async () => {
    execBehavior = () => Object.assign(new Error('gh failed'), { stderr: 'boom' });

    expect(await readHeadSha('/repo', 42)).toBeNull();
    expect(logWarn).toHaveBeenCalledTimes(1);
  });
});
