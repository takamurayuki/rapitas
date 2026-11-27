/**
 * verification-test-measurement.test
 *
 * Passed-case counts come only from complete runner reports; anything
 * truncated, empty, timed out or unmeasurable yields undefined, never a guess.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import {
  detectMeasuredRunner,
  parsePassedCount,
  runMeasuredTest,
  runMeasuredTests,
  sumPassedCounts,
  withReporter,
} from './verification-test-measurement';

const junit = (attrs: string, close = true, file = 'a') => {
  const count = (key: string) => Number(attrs.match(new RegExp(`${key}="(\\d+)"`))?.[1] ?? 0);
  const cases = Array.from({ length: count('tests') }, (_, i) => {
    const state =
      i < count('failures')
        ? 'failure'
        : i < count('failures') + count('errors')
          ? 'error'
          : i < count('failures') + count('errors') + count('skipped')
            ? 'skipped'
            : null;
    return `<testcase name="${i}" file="${file}">${state ? `<${state}/>` : ''}</testcase>`;
  }).join('');
  return `<?xml version="1.0"?><testsuites ${attrs}><testsuite file="${file}">${cases}</testsuite>${close ? '</testsuites>' : ''}`;
};
const vitest = (passed: number, failed = 0, pending = 0, todo = 0) =>
  JSON.stringify({
    numTotalTests: passed + failed + pending + todo,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: todo,
    testResults: [
      {
        name: 'a',
        status: failed ? 'failed' : 'passed',
        endTime: 1,
        assertionResults: ['passed', 'failed', 'pending', 'todo'].flatMap((status, i) =>
          Array.from({ length: [passed, failed, pending, todo][i] }, () => ({ status })),
        ),
      },
    ],
  });

describe('parsePassedCount', () => {
  test('bun: tests - failures - skipped', () => {
    expect(parsePassedCount('bun', junit('tests="10" failures="2" skipped="1"'))).toBe(7);
  });

  test('bun: errors are subtracted too', () => {
    expect(parsePassedCount('bun', junit('tests="5" failures="0" errors="1" skipped="0"'))).toBe(4);
  });

  test('Bun: 全件スキップは実行済みの証拠にならない（D1）', () => {
    expect(parsePassedCount('bun', junit('tests="3" failures="0" skipped="3"'))).toBeUndefined();
  });

  test.each([
    ['no executed case', junit('tests="0" failures="0" skipped="0"')],
    ['truncated report', junit('tests="4" failures="0" skipped="0"', false)],
    ['no root element', 'garbage'],
    ['empty', ''],
    ['negative result', junit('tests="1" failures="2" skipped="0"')],
  ])('bun: %s is not measurable', (_label, raw) => {
    expect(parsePassedCount('bun', raw)).toBeUndefined();
  });

  test('vitest: numPassedTests of a finished run', () => {
    expect(parsePassedCount('vitest', vitest(8, 1, 2, 1))).toBe(8);
    expect(parsePassedCount('vitest', vitest(0, 2))).toBe(0);
    expect(parsePassedCount('bun', junit('tests="2" failures="2" skipped="0"'))).toBe(0);
  });

  test.each([
    ['no tests at all', '{"numPassedTests":0,"numTotalTests":0}'],
    ['missing fields', '{"success":true}'],
    ['non-integer', '{"numPassedTests":1.5,"numTotalTests":2}'],
    ['broken json', '{"numPassed'],
    ['集計値の矛盾（D3）', '{"numPassedTests":99,"numTotalTests":1}'],
    ['全件スキップ', vitest(0, 0, 2)],
    ['全件TODO', vitest(0, 0, 0, 2)],
    [
      'ケース数の不一致',
      vitest(1)
        .replace('"numPassedTests":1', '"numPassedTests":2')
        .replace('"numTotalTests":1', '"numTotalTests":2'),
    ],
    ['未完了', vitest(1).replace('"endTime":1', '"endTime":0')],
  ])('vitest: %s is not measurable', (_label, raw) => {
    expect(parsePassedCount('vitest', raw)).toBeUndefined();
  });
});

describe('実ランナーの計測境界（D1・D2）', () => {
  test.each(['成功', '全件スキップ', '対象欠落'])('Bun: %s', async (kind) => {
    const dir = mkdtempSync(join(tmpdir(), 'rapitas-measure-fixture-'));
    try {
      writeFileSync(
        join(dir, 'a.test.ts'),
        `import { test, expect } from 'bun:test';\ntest${kind === '全件スキップ' ? '.skip' : ''}('実測', () => expect(1).toBe(1));`,
      );
      const command = `bun test --isolate "./a.test.ts"${kind === '対象欠落' ? ' "./missing.test.ts"' : ''}`;
      const measured = await runMeasuredTest(command, dir, 10000, async (cmd, cwd) => {
        const args = cmd
          .match(/"[^"]*"|[^\s]+/g)!
          .slice(1)
          .map((s) => s.replace(/"/g, ''));
        const res = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
        return { code: res.status ?? 1, stdout: res.stdout, stderr: res.stderr };
      });
      expect(measured.res.code).toBe(0);
      expect(measured.passedCount).toBe(kind === '成功' ? 1 : undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // NOTE: The backend CI job installs only the backend, so the frontend's vitest
  // is absent there; the real-runner check runs wherever vitest is installed.
  const VITEST_CLI = resolve('../rapitas-frontend/node_modules/vitest/vitest.mjs');
  test.skipIf(!existsSync(VITEST_CLI))(
    'Vitest の実レポートを計測し、欠落した選択ファイルは拒否する',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'rapitas-vitest-fixture-'));
      const cli = VITEST_CLI;
      try {
        writeFileSync(
          join(dir, 'a.test.js'),
          "test('実測', () => expect(1).toBe(1)); test.skip('skip', () => {}); test.todo('todo');",
        );
        for (const missing of [false, true]) {
          const measured = await runMeasuredTest(
            `pnpm exec vitest run "./a.test.js"${missing ? ' "./missing.test.js"' : ''}`,
            dir,
            10000,
            async (cmd, cwd) => {
              const args = cmd
                .match(/"[^"]*"|[^\s]+/g)!
                .slice(4)
                .map((s) => s.replace(/"/g, ''));
              const res = spawnSync('node', [cli, 'run', ...args, '--globals', '--maxWorkers=1'], {
                cwd,
                encoding: 'utf8',
              });
              expect(res.status).toBe(0);
              const raw = readFileSync(cmd.match(/--outputFile.json="([^"]+)"/)![1], 'utf8');
              expect(parsePassedCount('vitest', raw), raw).toBe(1);
              return { code: res.status ?? 1, stdout: res.stdout, stderr: res.stderr };
            },
          );
          expect(measured.passedCount).toBe(missing ? undefined : 1);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    20000,
  );
});

describe('command helpers', () => {
  test('detects the runner from the scoped command', () => {
    expect(detectMeasuredRunner('bun test --isolate "a.test.ts"')).toBe('bun');
    expect(detectMeasuredRunner('pnpm exec vitest run "a.test.ts"')).toBe('vitest');
    expect(detectMeasuredRunner('npm run test')).toBeNull();
  });

  test('withReporter keeps the console reporter and writes to the given file', () => {
    expect(withReporter('bun test "a"', 'bun', 'C:\\t\\r.xml')).toContain(
      '--reporter=junit --reporter-outfile="C:/t/r.xml"',
    );
    const v = withReporter('pnpm exec vitest run "a"', 'vitest', '/t/r.json');
    expect(v).toContain('--reporter=default --reporter=json --outputFile.json="/t/r.json"');
  });
});

/** Fake runner: writes a report to the path found in the command, like the real CLI would. */
function fakeRun(report: string | null, code = 0) {
  const seen: string[] = [];
  const run = async (command: string) => {
    const out = command.match(/(?:--reporter-outfile|--outputFile\.json)="([^"]+)"/)?.[1];
    if (out) {
      seen.push(out);
      if (report !== null) writeFileSync(out, report);
    }
    return { code, stdout: '', stderr: '' };
  };
  return { run, seen };
}

describe('runMeasuredTest', () => {
  test('returns the count and removes its temp directory', async () => {
    const { run, seen } = fakeRun(junit('tests="4" failures="1" skipped="0"'), 1);
    const r = await runMeasuredTest('bun test --isolate "a"', '.', 1000, run);
    expect(r.res.code).toBe(1); // failure outcome is untouched
    expect(r.passedCount).toBe(3);
    expect(existsSync(dirname(seen[0]))).toBe(false);
  });

  test('a timeout never trusts a partial report', async () => {
    const { run } = fakeRun(junit('tests="4" failures="0" skipped="0"'), 124);
    const r = await runMeasuredTest('bun test "a"', '.', 1000, run);
    expect(r.passedCount).toBeUndefined();
  });

  test('a missing report file is unmeasured, not an error', async () => {
    const { run } = fakeRun(null);
    expect((await runMeasuredTest('bun test "a"', '.', 1000, run)).passedCount).toBeUndefined();
  });

  test('an unknown runner runs the command unchanged', async () => {
    const commands: string[] = [];
    const run = async (c: string) => {
      commands.push(c);
      return { code: 0, stdout: '', stderr: '' };
    };
    const r = await runMeasuredTest('npm run test', '.', 1000, run);
    expect(commands).toEqual(['npm run test']);
    expect(r.passedCount).toBeUndefined();
  });

  test('two overlapping runs write separate reports', async () => {
    const a = fakeRun(junit('tests="2" failures="0" skipped="0"'));
    const b = fakeRun(junit('tests="9" failures="0" skipped="0"', true, 'b'));
    const [ra, rb] = await Promise.all([
      runMeasuredTest('bun test "a"', '.', 1000, a.run),
      runMeasuredTest('bun test "b"', '.', 1000, b.run),
    ]);
    expect([ra.passedCount, rb.passedCount]).toEqual([2, 9]);
    expect(a.seen[0]).not.toBe(b.seen[0]);
  });

  test.each([
    ['corrupt', junit('tests="3" failures="0" skipped="0"', false, 'b'), 0],
    ['timed out', junit('tests="3" failures="0" skipped="0"', true, 'b'), 124],
  ] as const)(
    'reverse completion: a %s second run never changes the first run (plan: 状態と割り込み)',
    async (_label, badReport, badCode) => {
      // Run A starts first but finishes LAST; run B finishes first and is broken.
      let releaseA!: () => void;
      const aGate = new Promise<void>((resolve) => (releaseA = resolve));
      const outA: string[] = [];
      const runA = async (command: string) => {
        const out = command.match(/--reporter-outfile="([^"]+)"/)![1];
        outA.push(out);
        await aGate;
        writeFileSync(out, junit('tests="5" failures="1" skipped="0"'));
        return { code: 1, stdout: '', stderr: '' };
      };
      const outB: string[] = [];
      const runB = async (command: string) => {
        const out = command.match(/--reporter-outfile="([^"]+)"/)![1];
        outB.push(out);
        writeFileSync(out, badReport);
        return { code: badCode, stdout: '', stderr: '' };
      };
      const pendingA = runMeasuredTest('bun test "a"', '.', 1000, runA);
      const rb = await runMeasuredTest('bun test "b"', '.', 1000, runB);
      expect(rb.passedCount).toBeUndefined();
      expect(existsSync(dirname(outB[0]))).toBe(false); // B cleaned only its own dir
      expect(existsSync(dirname(outA[0]))).toBe(true); // A's dir is untouched while A runs
      releaseA();
      const ra = await pendingA;
      expect(ra.passedCount).toBe(4);
      expect(ra.res.code).toBe(1);
      expect(existsSync(dirname(outA[0]))).toBe(false);
    },
  );
});

describe('runMeasuredTests / sumPassedCounts', () => {
  test('sums commands in order and keeps each result', async () => {
    const reports = [
      junit('tests="2" failures="0" skipped="0"'),
      junit('tests="5" failures="1" skipped="0"', true, 'b'),
    ];
    let i = 0;
    const run = async (command: string) => {
      const out = command.match(/--reporter-outfile="([^"]+)"/)![1];
      writeFileSync(out, reports[i++]);
      return { code: 0, stdout: '', stderr: '' };
    };
    const r = await runMeasuredTests(['bun test "a"', 'bun test "b"'], '.', 1000, run);
    expect(r.runs.map((x) => x.command)).toEqual(['bun test "a"', 'bun test "b"']);
    expect(r.passedCount).toBe(6);
  });

  test('one unmeasured command makes the whole total unmeasured', async () => {
    const run = async () => ({ code: 0, stdout: '', stderr: '' });
    const r = await runMeasuredTests(['bun test "a"', 'npm run test'], '.', 1000, run);
    expect(r.passedCount).toBeUndefined();
  });

  test('sumPassedCounts needs every ran part measured', () => {
    expect(
      sumPassedCounts([
        { ran: true, passedCount: 2 },
        { ran: true, passedCount: 3 },
      ]),
    ).toBe(5);
    expect(sumPassedCounts([{ ran: true, passedCount: 2 }, { ran: false }])).toBe(2);
    expect(sumPassedCounts([{ ran: true, passedCount: 2 }, { ran: true }])).toBeUndefined();
    expect(sumPassedCounts([{ ran: false }])).toBeUndefined();
  });

  test('leaves no report directory behind', async () => {
    const { run, seen } = fakeRun(junit('tests="1" failures="0" skipped="0"'));
    await runMeasuredTests(['bun test "a"'], '.', 1000, run);
    expect(
      readdirSync(dirname(dirname(seen[0]))).includes(dirname(seen[0]).split(/[\\/]/).pop()!),
    ).toBe(false);
  });
});

describe('mergeChecks carries passedCount (task 1542)', () => {
  const part = (over: Record<string, unknown> = {}) => ({
    name: 'test' as const,
    ran: true,
    ok: true,
    errorCount: 0,
    details: '',
    ...over,
  });

  test('sums the passed counts of every ran part', async () => {
    const { mergeChecks } = await import('./automated-verifier');
    const merged = mergeChecks('test', [part({ passedCount: 4 }), part({ passedCount: 6 })]);
    expect(merged.passedCount).toBe(10);
  });

  test('one unmeasured ran part leaves the total unmeasured', async () => {
    const { mergeChecks } = await import('./automated-verifier');
    expect(mergeChecks('test', [part({ passedCount: 4 }), part()]).passedCount).toBeUndefined();
  });

  test('other check kinds never get a passedCount', async () => {
    const { mergeChecks } = await import('./automated-verifier');
    expect(mergeChecks('lint', [part({ passedCount: 4 })]).passedCount).toBeUndefined();
  });

  test('the failure verdict and error count are unchanged by the count', async () => {
    const { mergeChecks } = await import('./automated-verifier');
    const merged = mergeChecks('test', [
      part({ passedCount: 4 }),
      part({ ok: false, errorCount: 1, passedCount: 2, details: 'x failed' }),
    ]);
    expect([merged.ok, merged.errorCount, merged.passedCount]).toEqual([false, 1, 6]);
  });
});
