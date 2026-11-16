'use strict';
/**
 * dep-sync.test
 *
 * The failure this module exists to remove: on 2026-10-16 a merge bumped Tauri
 * to 2.12.x in package.json and both lockfiles, nobody reinstalled, and the
 * next `tauri dev` refused to start ("Found version mismatched Tauri
 * packages") because node_modules still held 2.10.x. So the tests below pin
 * the decision (lockfile changed → install, unchanged → nothing), the command
 * (pinned toolchain, frozen lockfile, never a bare global pnpm), the places it
 * must never act (a git worktree), and what happens when the install fails
 * (refuse, never start on the stale tree). No test runs a real installer.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PACKAGES,
  MARKER_FILE,
  readToolchain,
  isGitWorktree,
  hashLockfile,
  inspectPackage,
  buildInstallCommand,
  syncDependencies,
  syncForLaunch,
} = require('./dep-sync.cjs');

const TOOLCHAIN = { bun: '1.3.13', pnpm: '10.34.9', node: '24' };
const quietLog = { info() {}, warn() {}, error() {} };

/**
 * A throwaway repo laid out like rapitas: a `.git` directory (primary
 * checkout), the toolchain file, and the four packages with lockfiles and
 * node_modules present.
 */
function makeRepo({ worktree = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-sync-'));
  if (worktree) fs.writeFileSync(path.join(root, '.git'), 'gitdir: /somewhere/else\n');
  else fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.github'));
  fs.writeFileSync(path.join(root, '.github', 'toolchain.json'), JSON.stringify(TOOLCHAIN));
  for (const pkg of PACKAGES) {
    const dir = path.join(root, pkg.dir);
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, pkg.lockfile), `lock for ${pkg.name} v1\n`);
  }
  return root;
}

/** Record every package as installed from its current lockfile. */
function markAllInstalled(root) {
  for (const pkg of PACKAGES) {
    const hash = hashLockfile(path.join(root, pkg.dir, pkg.lockfile));
    fs.writeFileSync(
      path.join(root, pkg.dir, 'node_modules', MARKER_FILE),
      JSON.stringify({ version: 1, lockfile: pkg.lockfile, sha256: hash }),
    );
  }
}

function pkgByName(name) {
  return PACKAGES.find((p) => p.name === name);
}

/** An installer stand-in that records calls and returns a scripted status. */
function fakeInstaller(statusFor = () => 0) {
  const calls = [];
  const runInstall = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    return { status: statusFor(cwd, command, args) };
  };
  return { calls, runInstall };
}

const baseOpts = (root, extra = {}) => ({
  repoRoot: root,
  env: {},
  log: quietLog,
  getBunVersion: () => '1.3.13',
  ...extra,
});

describe('staleness detection', () => {
  test('no marker → stale (first run after this lands installs once)', () => {
    const root = makeRepo();
    assert.deepEqual(inspectPackage(root, pkgByName('backend')), {
      stale: true,
      reason: 'no-marker',
    });
  });

  test('marker matches the lockfile → up to date', () => {
    const root = makeRepo();
    markAllInstalled(root);
    assert.deepEqual(inspectPackage(root, pkgByName('desktop')), {
      stale: false,
      reason: 'up-to-date',
    });
  });

  test('lockfile changed since the install → stale', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-desktop', 'pnpm-lock.yaml'), 'tauri 2.12.4\n');
    assert.deepEqual(inspectPackage(root, pkgByName('desktop')), {
      stale: true,
      reason: 'lockfile-changed',
    });
  });

  test('node_modules missing → stale', () => {
    const root = makeRepo();
    fs.rmSync(path.join(root, 'rapitas-frontend', 'node_modules'), { recursive: true });
    assert.equal(inspectPackage(root, pkgByName('frontend')).reason, 'no-node-modules');
  });

  test('no lockfile → nothing to compare, never stale', () => {
    const root = makeRepo();
    fs.rmSync(path.join(root, 'package-lock.json'));
    assert.deepEqual(inspectPackage(root, pkgByName('root')), {
      stale: false,
      reason: 'no-lockfile',
    });
  });

  // git's autocrlf can rewrite line endings on checkout; that is not a
  // dependency change and must not trigger an install.
  test('CRLF and LF lockfiles hash the same', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-sync-hash-'));
    fs.writeFileSync(path.join(dir, 'a'), 'x\ny\n');
    fs.writeFileSync(path.join(dir, 'b'), 'x\r\ny\r\n');
    assert.equal(hashLockfile(path.join(dir, 'a')), hashLockfile(path.join(dir, 'b')));
  });
});

describe('pinned install commands', () => {
  test('pnpm packages go through npx with the pinned pnpm and a frozen lockfile', () => {
    const cmd = buildInstallCommand(pkgByName('desktop'), TOOLCHAIN);
    assert.equal(cmd.command, 'npx');
    assert.deepEqual(cmd.args.slice(0, 4), ['-y', 'pnpm@10.34.9', 'install', '--frozen-lockfile']);
    // Non-TTY pnpm aborts instead of purging a node_modules laid out by
    // another pnpm (the primary's was written by a global pnpm 12).
    assert.ok(cmd.args.includes('--config.confirm-modules-purge=false'));
  });

  test('a global pnpm is never invoked directly', () => {
    for (const pkg of PACKAGES) {
      assert.notEqual(buildInstallCommand(pkg, TOOLCHAIN).command, 'pnpm');
    }
  });

  test('bun installs with a frozen lockfile', () => {
    assert.deepEqual(buildInstallCommand(pkgByName('backend'), TOOLCHAIN), {
      command: 'bun',
      args: ['install', '--frozen-lockfile'],
    });
  });

  test('npm uses ci, which never writes package-lock.json', () => {
    const cmd = buildInstallCommand(pkgByName('root'), TOOLCHAIN);
    assert.equal(cmd.command, 'npm');
    assert.equal(cmd.args[0], 'ci');
  });

  test('reads the pins from .github/toolchain.json of this repo', () => {
    const real = readToolchain(path.resolve(__dirname, '../..'));
    assert.match(real.pnpm, /^\d+\.\d+\.\d+$/);
    assert.match(real.bun, /^\d+\.\d+\.\d+$/);
  });
});

describe('syncDependencies', () => {
  test('lockfile changed → installs exactly that package, then records it', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-desktop', 'pnpm-lock.yaml'), 'tauri 2.12.4\n');
    const inst = fakeInstaller();
    const result = syncDependencies(baseOpts(root, { runInstall: inst.runInstall }));
    assert.equal(result.ok, true);
    assert.equal(result.status, 'installed');
    assert.deepEqual(result.installed, ['desktop']);
    assert.equal(inst.calls.length, 1);
    assert.equal(inst.calls[0].cwd, path.join(root, 'rapitas-desktop'));

    // Second start on the same lockfile: no reinstall.
    const again = fakeInstaller();
    const second = syncDependencies(baseOpts(root, { runInstall: again.runInstall }));
    assert.equal(second.status, 'up-to-date');
    assert.equal(again.calls.length, 0);
  });

  test('nothing changed → no install at all', () => {
    const root = makeRepo();
    markAllInstalled(root);
    const inst = fakeInstaller();
    const result = syncDependencies(baseOpts(root, { runInstall: inst.runInstall }));
    assert.equal(result.ok, true);
    assert.equal(result.status, 'up-to-date');
    assert.equal(inst.calls.length, 0);
  });

  test('git worktree → skipped, installer never called', () => {
    const root = makeRepo({ worktree: true });
    const inst = fakeInstaller();
    const result = syncDependencies(baseOpts(root, { runInstall: inst.runInstall }));
    assert.equal(result.ok, true);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'git-worktree');
    assert.equal(inst.calls.length, 0);
    assert.equal(isGitWorktree(root), true);
  });

  test('RAPITAS_SKIP_DEP_SYNC=1 → skipped', () => {
    const root = makeRepo();
    const inst = fakeInstaller();
    const result = syncDependencies(
      baseOpts(root, { runInstall: inst.runInstall, env: { RAPITAS_SKIP_DEP_SYNC: '1' } }),
    );
    assert.equal(result.reason, 'disabled-by-env');
    assert.equal(inst.calls.length, 0);
  });

  test('install fails → refused, named, and the marker is not written', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-backend', 'bun.lock'), 'changed\n');
    const inst = fakeInstaller(() => 1);
    const result = syncDependencies(baseOpts(root, { runInstall: inst.runInstall }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'install-failed');
    assert.equal(result.failedPackage, 'backend');
    assert.match(result.message, /bun install --frozen-lockfile/);
    assert.match(result.message, /rapitas-backend/);
    // Still stale: the next start must try again rather than trust it.
    assert.equal(inspectPackage(root, pkgByName('backend')).stale, true);
  });

  test('the global bun is not the pin → refuses before installing anything', () => {
    const root = makeRepo();
    const inst = fakeInstaller();
    const result = syncDependencies(
      baseOpts(root, { runInstall: inst.runInstall, getBunVersion: () => '1.4.0' }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'bun-version-mismatch');
    assert.match(result.message, /1\.4\.0/);
    assert.match(result.message, /1\.3\.13/);
    assert.equal(inst.calls.length, 0);
  });

  test('bun not found → refuses', () => {
    const root = makeRepo();
    const inst = fakeInstaller();
    const result = syncDependencies(
      baseOpts(root, { runInstall: inst.runInstall, getBunVersion: () => null }),
    );
    assert.equal(result.reason, 'bun-unavailable');
    assert.equal(inst.calls.length, 0);
  });

  test('a stale pnpm package alone does not need bun', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-frontend', 'pnpm-lock.yaml'), 'changed\n');
    const inst = fakeInstaller();
    const result = syncDependencies(
      baseOpts(root, { runInstall: inst.runInstall, getBunVersion: () => null }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.installed, ['frontend']);
  });

  test('a thrown/unspawnable installer counts as a failure', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'package-lock.json'), 'changed\n');
    const result = syncDependencies(
      baseOpts(root, { runInstall: () => ({ status: null, error: new Error('ENOENT') }) }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.failedPackage, 'root');
  });
});

describe('syncForLaunch (dev.js startup and post-pull restart)', () => {
  test('frontend stale → the running frontend is stopped before installing', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-frontend', 'pnpm-lock.yaml'), 'changed\n');
    const order = [];
    const result = syncForLaunch(
      baseOpts(root, {
        stopFrontend: () => order.push('stop'),
        runInstall: (c, a, cwd) => {
          order.push(`install:${path.basename(cwd)}`);
          return { status: 0 };
        },
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.frontendStopped, true);
    assert.deepEqual(order, ['stop', 'install:rapitas-frontend']);
  });

  test('frontend up to date → left running', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-backend', 'bun.lock'), 'changed\n');
    let stopped = false;
    const result = syncForLaunch(
      baseOpts(root, { stopFrontend: () => (stopped = true), runInstall: () => ({ status: 0 }) }),
    );
    assert.equal(result.ok, true);
    assert.equal(stopped, false);
    assert.deepEqual(result.installed, ['backend']);
  });

  // The tauri CLI is the parent of dev.js and holds its native binary open,
  // so the desktop package cannot be reinstalled from inside dev.js. It is
  // reported instead, and the `tauri` script syncs it before the CLI starts.
  test('desktop stale → not installed here, reported', () => {
    const root = makeRepo();
    markAllInstalled(root);
    fs.writeFileSync(path.join(root, 'rapitas-desktop', 'pnpm-lock.yaml'), 'changed\n');
    const inst = fakeInstaller();
    const result = syncForLaunch(
      baseOpts(root, { stopFrontend() {}, runInstall: inst.runInstall }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.desktopStale, true);
    assert.equal(inst.calls.length, 0);
  });

  test('install failure → not ok, so the caller refuses to start', () => {
    const root = makeRepo();
    const result = syncForLaunch(
      baseOpts(root, { stopFrontend() {}, runInstall: () => ({ status: 1 }) }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'install-failed');
  });

  test('worktree → skipped without stopping anything', () => {
    const root = makeRepo({ worktree: true });
    let stopped = false;
    const result = syncForLaunch(
      baseOpts(root, { stopFrontend: () => (stopped = true), runInstall: () => ({ status: 1 }) }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'git-worktree');
    assert.equal(stopped, false);
  });
});

// The module is only useful if it is called. These read the call sites, so a
// later edit that drops the wiring goes red here instead of silently.
describe('wiring', () => {
  const devSource = fs.readFileSync(path.join(__dirname, 'dev.js'), 'utf8');

  test('dev.js syncs before startup and before a backend restart', () => {
    assert.ok(devSource.includes("require('./dep-sync.cjs')"), 'dev.js must require dep-sync');
    const helper = devSource.slice(devSource.indexOf('function runDependencySync('));
    assert.ok(helper.indexOf('syncForLaunch(') !== -1, 'runDependencySync must call syncForLaunch');
    const mainBody = devSource.slice(devSource.indexOf('async function main()'));
    const startupCall = mainBody.indexOf("runDependencySync('startup')");
    assert.ok(
      startupCall !== -1 && startupCall < mainBody.indexOf('syncDatabaseAndGenerateClient()'),
      'main() must sync dependencies before Prisma generate and startBackend',
    );
    const restart = devSource.slice(devSource.indexOf('async function restartBackendInner('));
    const restartCall = restart.indexOf("runDependencySync('restart')");
    assert.ok(
      restartCall !== -1 && restartCall < restart.indexOf('startBackend()'),
      'restartBackendInner must sync dependencies before startBackend',
    );
  });

  test('the tauri scripts sync the desktop package before the CLI starts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    for (const name of ['tauri', 'tauri:watch', 'tauri:only']) {
      assert.match(pkg.scripts[name], /^node scripts\/dep-sync\.cjs --only desktop && tauri /);
    }
  });
});
