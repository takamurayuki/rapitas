#!/usr/bin/env node
/**
 * install-ci-system-deps.test.cjs
 *
 * Node-test-runner suite for install-ci-system-deps.sh's retry/timeout
 * handling (bun/vitest-free, matching the other scripts/*.test.cjs tools).
 * Run with: node --test scripts/install-ci-system-deps.test.cjs
 *
 * Why this exists: the apt step hung indefinitely on 2 of 40 tauri-build runs
 * (observed 113 and 35 minutes) while holding a BLOCKING auto-merge check that
 * had no timeout-minutes, so every PR behind it stalled. The retry wrapper is
 * what bounds that, and the subtle part is propagating the real exit code — an
 * earlier draft captured it with `if ...; then return 0; fi; status=$?`, which
 * always reads 0 because a failed `if` with no else leaves $? at 0, turning a
 * total apt failure into a GREEN build. These tests pin that down.
 *
 * The script's two hardcoded /etc/apt paths are rewritten into a sandbox so the
 * real retry code runs unmodified; only `sudo` and `timeout` are stubbed.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'install-ci-system-deps.sh');

/** `sudo` stub: drop leading VAR=value prefixes like the real one, then exec. */
const SUDO_STUB = `#!/usr/bin/env bash
while [[ "\${1:-}" == *=* && "\${1:-}" != /* ]]; do
  export "$1"
  shift
done
exec "$@"
`;

/** `timeout` stub: count attempts, fail the first SIM_FAIL_UNTIL with SIM_FAIL_CODE. */
const TIMEOUT_STUB = `#!/usr/bin/env bash
shift
n=$(( $(cat "$ATTEMPT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$ATTEMPT_FILE"
if [[ $n -le \${SIM_FAIL_UNTIL:-0} ]]; then
  exit "\${SIM_FAIL_CODE:-124}"
fi
exit 0
`;

/**
 * Run the installer in a sandbox with stubbed sudo/timeout.
 *
 * @param simFailUntil - How many apt attempts the stub fails before succeeding. / 失敗させる試行回数
 * @param simFailCode - Exit code those attempts fail with (124 = timeout kill). / 失敗時の終了コード
 * @returns The script's exit status and how many apt invocations it made. / 終了コードと試行回数
 */
function runInstaller(simFailUntil, simFailCode) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-apt-'));
  try {
    const bin = path.join(sandbox, 'bin');
    const aptDir = path.join(sandbox, 'etc', 'apt', 'sources.list.d');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(aptDir, { recursive: true });
    const sources = path.join(aptDir, 'ubuntu.sources');
    fs.writeFileSync(sources, 'deb http://example.invalid main\n');

    // Rewrite only the absolute paths; the retry code under test is untouched.
    const posix = (p) => p.replace(/\\/g, '/');
    const script = fs
      .readFileSync(SCRIPT, 'utf8')
      .split('/etc/apt/sources.list.d/ubuntu.sources')
      .join(posix(sources))
      .replace(/\/etc\/apt\/sources\.list(?=\s|$)/gm, posix(path.join(sandbox, 'etc/apt/sources.list')));
    const scriptPath = path.join(sandbox, 'script.sh');
    fs.writeFileSync(scriptPath, script);

    fs.writeFileSync(path.join(bin, 'sudo'), SUDO_STUB, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'timeout'), TIMEOUT_STUB, { mode: 0o755 });

    const attemptFile = path.join(sandbox, 'attempts');
    fs.writeFileSync(attemptFile, '');

    const result = spawnSync('bash', [posix(scriptPath), 'pkg-a', 'pkg-b'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${posix(bin)}${path.delimiter}${process.env.PATH}`,
        ATTEMPT_FILE: posix(attemptFile),
        SIM_FAIL_UNTIL: String(simFailUntil),
        SIM_FAIL_CODE: String(simFailCode),
        CI_APT_ATTEMPTS: '3',
        // The real 10s+15s backoff is not what these tests are checking.
        CI_APT_RETRY_BACKOFF_SECONDS: '0',
      },
    });

    const attempts = Number(fs.readFileSync(attemptFile, 'utf8').trim() || '0');
    return { status: result.status, attempts, stderr: result.stderr ?? '' };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

test('healthy apt runs update and install exactly once each', () => {
  const { status, attempts } = runInstaller(0, 0);
  assert.equal(status, 0, 'should exit 0');
  assert.equal(attempts, 2, 'update + install, no retries');
});

test('a single timeout is retried and the step still succeeds', () => {
  const { status, attempts } = runInstaller(1, 124);
  assert.equal(status, 0, 'the retry should rescue a transient hang');
  // update fails once then succeeds (2 calls), install succeeds (1 call).
  assert.equal(attempts, 3);
});

test('a persistent timeout gives up after the attempt budget with exit 124', () => {
  const { status, attempts } = runInstaller(9, 124);
  assert.equal(status, 124, 'must surface the timeout, not report success');
  assert.equal(attempts, 3, 'exactly CI_APT_ATTEMPTS attempts, then stop');
});

test("a real apt failure's exit code propagates instead of being masked", () => {
  // Regression guard: with `if ...; then return 0; fi; status=$?` this returned
  // 0 and the build went green on a total apt failure.
  const { status, attempts } = runInstaller(9, 100);
  assert.equal(status, 100);
  assert.equal(attempts, 3);
});

test('the failing stage is named in the warning so logs identify it', () => {
  const { stderr } = runInstaller(9, 124);
  assert.match(stderr, /apt-get update exceeded \d+s \(attempt 1\/3\)/);
  assert.match(stderr, /apt-get update failed after 3 attempts/);
});
