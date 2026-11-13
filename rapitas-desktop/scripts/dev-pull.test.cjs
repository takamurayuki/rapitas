'use strict';
/**
 * dev-pull.test
 *
 * The launch must never be stopped by the pull, and the pull must never
 * create a merge commit or touch uncommitted work. So the cases below run
 * against real throwaway git repositories (a bare "origin" plus a clone):
 * behind → fast-forwarded, dirty → untouched, diverged → untouched, local
 * ahead → nothing to do. Offline and disabled are driven through a fake
 * runner / an unreachable remote. No test touches the network.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  pullOnLaunch,
  describePull,
  isPullEnabled,
  PULLED,
  UP_TO_DATE,
  SKIPPED_DISABLED,
  SKIPPED_NOT_A_REPO,
  SKIPPED_DETACHED,
  SKIPPED_DIRTY,
  SKIPPED_OFFLINE,
  SKIPPED_DIVERGED,
  SKIPPED_MERGE_FAILED,
} = require('./dev-pull.cjs');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: os.devNull,
};

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(cwd, file, content) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', `edit ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

/**
 * A bare origin, the checkout under test ("local") and a second clone used to
 * push new commits ("other"). Both clones start on develop at the same commit.
 */
function makeRepos() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pull-'));
  const origin = path.join(root, 'origin.git');
  const local = path.join(root, 'local');
  const other = path.join(root, 'other');
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin);
  git(root, 'clone', '-q', origin, other);
  git(other, 'checkout', '-q', '-b', 'develop');
  commitFile(other, 'README.md', 'base\n');
  git(other, 'push', '-q', '-u', 'origin', 'develop');
  git(root, 'clone', '-q', '-b', 'develop', origin, local);
  /** Land a new commit on origin/develop from the other clone. */
  const pushUpstream = (file = 'feature.txt', content = 'new\n') => {
    const sha = commitFile(other, file, content);
    git(other, 'push', '-q', 'origin', 'develop');
    return sha;
  };
  return { root, origin, local, other, pushUpstream };
}

/** The real runner, but with the hermetic git environment of these tests. */
function hermeticRun(command, args, options) {
  return new Promise((resolve) => {
    require('child_process').execFile(
      command,
      args,
      { encoding: 'utf8', ...options, env: { ...GIT_ENV, ...(options.env || {}), ...GIT_ENV } },
      (err, stdout, stderr) =>
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          timedOut: Boolean(err && err.killed),
          stdout,
          stderr,
        }),
    );
  });
}

describe('pullOnLaunch against real repositories', () => {
  test('clean and behind → fast-forwards and reports old → new', async () => {
    const r = makeRepos();
    const before = git(r.local, 'rev-parse', 'HEAD');
    const upstreamTip = r.pushUpstream();

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, PULLED);
    assert.equal(result.from, before);
    assert.equal(result.to, upstreamTip);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), upstreamTip);
    assert.equal(result.commits.length, 1);
    assert.equal(result.launcherChanged, false);
    // A fast-forward, not a merge: HEAD has a single parent.
    assert.equal(git(r.local, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 2);
  });

  test('flags a pull that changed the launcher scripts themselves', async () => {
    const r = makeRepos();
    r.pushUpstream('rapitas-desktop/scripts/dev.js', '// new launcher\n');

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, PULLED);
    assert.equal(result.launcherChanged, true);
    assert.match(describePull(result).lines.join('\n'), /previous dev\.js/);
  });

  test('already up to date → nothing happens', async () => {
    const r = makeRepos();
    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });
    assert.equal(result.action, UP_TO_DATE);
  });

  test('uncommitted tracked changes → skipped, tree and HEAD untouched', async () => {
    const r = makeRepos();
    const before = git(r.local, 'rev-parse', 'HEAD');
    r.pushUpstream();
    fs.writeFileSync(path.join(r.local, 'README.md'), 'local edit\n');

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, SKIPPED_DIRTY);
    assert.deepEqual(result.files, ['M README.md']);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), before);
    assert.equal(fs.readFileSync(path.join(r.local, 'README.md'), 'utf8'), 'local edit\n');
  });

  test('an untracked scratch file alone does not block the pull', async () => {
    const r = makeRepos();
    const tip = r.pushUpstream();
    fs.writeFileSync(path.join(r.local, 'scratch.txt'), 'notes\n');

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, PULLED);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), tip);
    assert.ok(fs.existsSync(path.join(r.local, 'scratch.txt')));
  });

  test('a local ignored file at a path upstream starts tracking → refused, file and HEAD kept', async () => {
    const r = makeRepos();
    // Base: secret.env is ignored on both sides.
    r.pushUpstream('.gitignore', 'secret.env\n');
    git(r.local, 'pull', '-q', '--ff-only');
    const before = git(r.local, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(r.local, 'secret.env'), 'local secret\n');
    // Upstream force-adds the same path as a tracked file.
    fs.writeFileSync(path.join(r.other, 'secret.env'), 'upstream template\n');
    git(r.other, 'add', '-f', 'secret.env');
    git(r.other, 'commit', '-q', '-m', 'track secret.env');
    git(r.other, 'push', '-q', 'origin', 'develop');

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, SKIPPED_MERGE_FAILED);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), before);
    assert.equal(fs.readFileSync(path.join(r.local, 'secret.env'), 'utf8'), 'local secret\n');
    assert.match(
      describePull(result).lines.join('\n'),
      /Starting with the code already checked out/,
    );
  });

  test('merge.autoStash=true and an edit lands after the dirty check → refused, no stash', async () => {
    const r = makeRepos();
    const before = git(r.local, 'rev-parse', 'HEAD');
    r.pushUpstream('README.md', 'upstream\n');
    git(r.local, 'config', 'merge.autoStash', 'true');
    // The edit happens while the fetch runs, i.e. after `git status` said clean.
    const run = async (c, a, o) => {
      const res = await hermeticRun(c, a, o);
      if (a[0] === 'fetch') fs.writeFileSync(path.join(r.local, 'README.md'), 'local edit\n');
      return res;
    };

    const result = await pullOnLaunch({ repoRoot: r.local, run });

    assert.equal(result.action, SKIPPED_MERGE_FAILED);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), before);
    assert.equal(fs.readFileSync(path.join(r.local, 'README.md'), 'utf8'), 'local edit\n');
    assert.equal(git(r.local, 'stash', 'list'), '');
  });

  test('a post-merge hook that never exits → pulled with a warning after the timeout, launch not held', async () => {
    const r = makeRepos();
    const before = git(r.local, 'rev-parse', 'HEAD');
    // Touch the launcher path so launcherChanged must still be collected.
    const tip = r.pushUpstream('rapitas-desktop/scripts/dev.js', '// new launcher\n');
    const pidFile = path.join(r.root, 'hook.pid');
    const hook = path.join(r.local, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hook, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`);
    fs.chmodSync(hook, 0o755);

    const started = Date.now();
    try {
      const result = await pullOnLaunch({
        repoRoot: r.local,
        run: hermeticRun,
        fetchTimeoutMs: 1500,
      });
      assert.ok(Date.now() - started < 10_000, 'returned well before the hook would exit');
      // The fast-forward finished before the hook hung: report what really happened.
      assert.equal(git(r.local, 'rev-parse', 'HEAD'), tip);
      assert.equal(result.action, PULLED);
      assert.equal(result.from, before);
      assert.equal(result.to, tip);
      assert.equal(result.commits.length, 1);
      assert.equal(result.launcherChanged, true);
      assert.match(result.warning, /did not exit within 2s/);
      const d = describePull(result);
      const text = d.lines.join('\n');
      assert.equal(d.level, 'warn');
      assert.match(text, /Pulled 1 commit from origin\/develop/);
      assert.match(text, /previous dev\.js/);
      assert.match(text, /post-merge hook may be hanging/);
      assert.doesNotMatch(text, /git pull skipped/);
    } finally {
      // The hook outlives the killed git; do not leave it behind.
      try {
        process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()));
      } catch {
        /* already gone */
      }
    }
  });

  test('diverged from upstream → skipped, no merge commit made', async () => {
    const r = makeRepos();
    r.pushUpstream();
    const localTip = commitFile(r.local, 'local.txt', 'mine\n');

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, SKIPPED_DIVERGED);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), localTip);
  });

  test('local only ahead of upstream → up to date, nothing pulled', async () => {
    const r = makeRepos();
    const localTip = commitFile(r.local, 'local.txt', 'mine\n');

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, UP_TO_DATE);
    assert.equal(result.localAhead, true);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), localTip);
  });

  test('remote unreachable → skipped with the reason, HEAD untouched', async () => {
    const r = makeRepos();
    const before = git(r.local, 'rev-parse', 'HEAD');
    git(r.local, 'remote', 'set-url', 'origin', path.join(r.root, 'gone.git'));

    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });

    assert.equal(result.action, SKIPPED_OFFLINE);
    // The fatal line, not git's trailing "and the repository exists." hint.
    assert.match(result.reason, /^fatal:/);
    assert.equal(git(r.local, 'rev-parse', 'HEAD'), before);
  });

  test('detached HEAD → skipped', async () => {
    const r = makeRepos();
    git(r.local, 'checkout', '-q', '--detach');
    const result = await pullOnLaunch({ repoRoot: r.local, run: hermeticRun });
    assert.equal(result.action, SKIPPED_DETACHED);
  });

  test('not a git checkout → skipped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pull-norepo-'));
    const result = await pullOnLaunch({
      repoRoot: dir,
      run: (c, a, o) => hermeticRun(c, a, { ...o, env: { GIT_CEILING_DIRECTORIES: os.tmpdir() } }),
    });
    assert.equal(result.action, SKIPPED_NOT_A_REPO);
  });
});

describe('pullOnLaunch decisions with a fake runner', () => {
  test('disabled → no git command runs at all', async () => {
    const calls = [];
    const result = await pullOnLaunch({
      repoRoot: '/repo',
      enabled: false,
      run: async (c, a) => {
        calls.push([c, ...a].join(' '));
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.action, SKIPPED_DISABLED);
    assert.deepEqual(calls, []);
  });

  test('a failed fetch (timeout / offline) never reaches merge', async () => {
    const calls = [];
    const run = async (c, a, o) => {
      calls.push({ args: a, options: o });
      const sub = a[0];
      if (sub === 'rev-parse' && a[1] === '--is-inside-work-tree')
        return { code: 0, stdout: 'true\n', stderr: '' };
      if (sub === 'rev-parse' && a.includes('@{u}'))
        return { code: 0, stdout: 'origin/develop\n', stderr: '' };
      if (sub === 'rev-parse') return { code: 0, stdout: 'develop\n', stderr: '' };
      if (sub === 'status') return { code: 0, stdout: '', stderr: '' };
      if (sub === 'fetch')
        return {
          code: 128,
          stdout: '',
          stderr:
            'fatal: unable to access: Could not resolve host\n' +
            'Please make sure you have the correct access rights\n' +
            'and the repository exists.\n',
        };
      throw new Error(`unexpected git ${a.join(' ')}`);
    };

    const result = await pullOnLaunch({ repoRoot: '/repo', run, fetchTimeoutMs: 1234 });

    assert.equal(result.action, SKIPPED_OFFLINE);
    assert.equal(result.reason, 'fatal: unable to access: Could not resolve host');
    const fetch = calls.find((c) => c.args[0] === 'fetch');
    assert.equal(fetch.options.timeout, 1234);
    assert.equal(fetch.options.env.GIT_TERMINAL_PROMPT, '0');
    assert.ok(!calls.some((c) => c.args[0] === 'merge'));
  });
  test('merge runs with --ff-only, --no-autostash, --no-overwrite-ignore and the timeout', async () => {
    const calls = [];
    const run = async (c, a, o) => {
      calls.push({ args: a, options: o });
      const sub = a[0];
      if (sub === 'rev-parse' && a[1] === '--is-inside-work-tree')
        return { code: 0, stdout: 'true\n', stderr: '' };
      if (sub === 'rev-parse' && a.includes('@{u}'))
        return { code: 0, stdout: 'origin/develop\n', stderr: '' };
      if (sub === 'rev-parse' && a[1] === '--abbrev-ref')
        return { code: 0, stdout: 'develop\n', stderr: '' };
      if (sub === 'rev-parse' && a[1] === 'HEAD')
        return { code: 0, stdout: 'a'.repeat(40), stderr: '' };
      if (sub === 'rev-parse') return { code: 0, stdout: 'b'.repeat(40), stderr: '' };
      if (sub === 'merge') return { code: 1, timedOut: true, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const result = await pullOnLaunch({ repoRoot: '/repo', run, fetchTimeoutMs: 4321 });

    const merge = calls.find((c) => c.args[0] === 'merge');
    for (const flag of ['--ff-only', '--no-autostash', '--no-overwrite-ignore'])
      assert.ok(merge.args.includes(flag), flag);
    assert.equal(merge.options.timeout, 4321);
    // HEAD still reads as `from` after the timeout: the merge itself stopped.
    assert.equal(result.action, SKIPPED_MERGE_FAILED);
    assert.match(result.reason, /did not finish within 4s.*check 'git status'/);
  });

  /** Fake git for the merge-timeout cases; headAfterMerge drives the re-check. */
  function timeoutRunner(headAfterMerge) {
    let merged = false;
    return async (c, a) => {
      const sub = a[0];
      if (sub === 'rev-parse' && a[1] === '--is-inside-work-tree')
        return { code: 0, stdout: 'true\n', stderr: '' };
      if (sub === 'rev-parse' && a.includes('@{u}'))
        return { code: 0, stdout: 'origin/develop\n', stderr: '' };
      if (sub === 'rev-parse' && a[1] === '--abbrev-ref')
        return { code: 0, stdout: 'develop\n', stderr: '' };
      if (sub === 'rev-parse' && a[1] === 'HEAD')
        return merged ? headAfterMerge : { code: 0, stdout: 'a'.repeat(40), stderr: '' };
      if (sub === 'rev-parse') return { code: 0, stdout: 'b'.repeat(40), stderr: '' };
      if (sub === 'merge') {
        merged = true;
        return { code: 1, timedOut: true, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
  }

  test('merge timed out but HEAD reached the target → pulled with a warning', async () => {
    const run = timeoutRunner({ code: 0, stdout: `${'b'.repeat(40)}\n`, stderr: '' });
    const result = await pullOnLaunch({ repoRoot: '/repo', run, fetchTimeoutMs: 4321 });
    assert.equal(result.action, PULLED);
    assert.match(result.warning, /did not exit within 4s/);
  });

  test('merge timed out and HEAD cannot be re-read → merge-failed (safe side)', async () => {
    const run = timeoutRunner({ code: 128, stdout: '', stderr: 'fatal: bad HEAD' });
    const result = await pullOnLaunch({ repoRoot: '/repo', run, fetchTimeoutMs: 4321 });
    assert.equal(result.action, SKIPPED_MERGE_FAILED);
    assert.match(result.reason, /check 'git status'/);
  });
});

describe('isPullEnabled', () => {
  test('on by default', () => assert.equal(isPullEnabled([], {}), true));
  test('--no-pull turns it off', () =>
    assert.equal(isPullEnabled(['--force', '--no-pull'], {}), false));
  test('RAPITAS_DEV_PULL=0 / false turns it off', () => {
    assert.equal(isPullEnabled([], { RAPITAS_DEV_PULL: '0' }), false);
    assert.equal(isPullEnabled([], { RAPITAS_DEV_PULL: 'false' }), false);
    assert.equal(isPullEnabled([], { RAPITAS_DEV_PULL: '1' }), true);
  });
});

describe('describePull', () => {
  test('pulled → info with old → new and the subjects', () => {
    const d = describePull({
      action: PULLED,
      upstream: 'origin/develop',
      from: 'a'.repeat(40),
      to: 'b'.repeat(40),
      commits: ['bbbbbbb second', 'ccccccc first'],
      launcherChanged: false,
    });
    assert.equal(d.level, 'info');
    assert.match(d.lines[0], /Pulled 2 commits from origin\/develop/);
    assert.match(d.lines[0], /aaaaaaaaaaaa → bbbbbbbbbbbb/);
    assert.equal(d.lines.length, 3);
  });

  test('every skip says why and that the launch continues', () => {
    const skips = [
      { action: SKIPPED_DIRTY, branch: 'develop', files: ['M a', 'M b'] },
      {
        action: SKIPPED_DIVERGED,
        branch: 'develop',
        upstream: 'origin/develop',
        from: 'a',
        to: 'b',
      },
      { action: SKIPPED_OFFLINE, upstream: 'origin/develop', reason: 'no network' },
      { action: SKIPPED_NOT_A_REPO },
      { action: SKIPPED_DETACHED },
    ];
    for (const s of skips) {
      const d = describePull(s);
      assert.equal(d.level, 'warn', s.action);
      assert.match(d.lines.join('\n'), /git pull skipped/, s.action);
      assert.match(d.lines.join('\n'), /Starting with the code already checked out/, s.action);
    }
  });
});
