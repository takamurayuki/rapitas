#!/usr/bin/env node
/**
 * setup-worktree.cjs
 *
 * Prepares a git worktree so that tests, type-checks, and lint can be run
 * inside it without invoking any package installer. Shared resources are
 * linked from the main worktree; per-worktree files (.env) are copied.
 *
 * Cross-platform: uses fs.symlinkSync with type 'junction' so Windows gets
 * directory junctions (no admin required) and POSIX gets regular symlinks.
 *
 * NEVER runs npm/bun/pnpm install. Dependency installation is the user's
 * responsibility and must happen in the main worktree only — running it in
 * a linked worktree would mutate the shared node_modules and cause cascading
 * breakage in other worktrees and the main checkout.
 *
 * Usage:
 *   node scripts/setup-worktree.cjs                # operate on $CWD
 *   node scripts/setup-worktree.cjs <worktree>     # operate on given path
 *   node scripts/setup-worktree.cjs --check        # report status, do not modify
 *   node scripts/setup-worktree.cjs --teardown     # remove links/copies before
 *                                                  # `git worktree remove`
 *
 * IMPORTANT: junctions/symlinks confuse `git worktree remove` and `rm -rf` on
 * Windows. Always run `--teardown` before deleting a worktree.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const TEARDOWN = args.includes('--teardown');
const positional = args.filter((a) => !a.startsWith('--'));

/** node_modules directories to link from main into the worktree. */
const NODE_MODULES_DIRS = [
  '',
  'rapitas-backend',
  'rapitas-frontend',
  'rapitas-desktop',
  'rapitas-manager',
];

/**
 * Generated build artifacts that need linking from the main worktree.
 *
 * NOTE: `rapitas-backend/src/generated/` is intentionally NOT listed: those
 * files are tracked in git and are checked out normally into every worktree.
 * The Prisma client itself lives under `node_modules/@prisma/client` and
 * `node_modules/.prisma/client`, which are covered by the node_modules link.
 */
const GENERATED_DIRS = [];

/** Env files copied (not linked) so worktree teardown cannot delete originals. */
const ENV_FILES = [
  'rapitas-backend/.env',
  'rapitas-frontend/.env.local',
  'rapitas-frontend/.env',
  'rapitas-desktop/.env',
];

function fail(msg) {
  console.error(`setup-worktree: ${msg}`);
  process.exit(1);
}

function resolveMainWorktree(worktree) {
  let out;
  try {
    out = execSync('git worktree list --porcelain', {
      cwd: worktree,
      encoding: 'utf8',
    });
  } catch (err) {
    fail(`failed to run git worktree list: ${err.message}`);
  }
  // The first "worktree <path>" entry is the main worktree.
  const first = out.split(/\r?\n\r?\n/)[0];
  const m = first && first.match(/^worktree (.+)$/m);
  if (!m) fail('could not determine main worktree path');
  return path.resolve(m[1].trim());
}

function isLinkAt(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function existsAt(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (_) {
    return false;
  }
}

function ensureLink(target, link, label) {
  if (!existsAt(target)) {
    console.log(`  - ${label}: skip (target missing) ${target}`);
    return { action: 'skip', reason: 'target-missing' };
  }
  if (existsAt(link)) {
    if (isLinkAt(link)) {
      console.log(`  - ${label}: ok (already linked)`);
      return { action: 'skip', reason: 'already-linked' };
    }
    console.log(`  - ${label}: skip (exists, not a link) ${link}`);
    return { action: 'skip', reason: 'exists-not-link' };
  }
  if (CHECK_ONLY) {
    console.log(`  - ${label}: would link -> ${target}`);
    return { action: 'would-link' };
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  // 'junction' is honored on Windows (creates a directory junction, no admin
  // required) and ignored on POSIX (a normal symlink is created).
  fs.symlinkSync(target, link, 'junction');
  console.log(`  - ${label}: linked -> ${target}`);
  return { action: 'linked' };
}

function removeLink(link, label) {
  if (!existsAt(link)) {
    console.log(`  - ${label}: skip (not present)`);
    return;
  }
  if (!isLinkAt(link)) {
    console.log(`  - ${label}: skip (not a link, leaving alone)`);
    return;
  }
  if (CHECK_ONLY) {
    console.log(`  - ${label}: would unlink`);
    return;
  }
  // unlinkSync removes a symlink/junction without recursing into the target.
  fs.unlinkSync(link);
  console.log(`  - ${label}: unlinked`);
}

function removeCopiedFile(dst, label) {
  if (!existsAt(dst)) {
    console.log(`  - ${label}: skip (not present)`);
    return;
  }
  if (CHECK_ONLY) {
    console.log(`  - ${label}: would remove`);
    return;
  }
  fs.unlinkSync(dst);
  console.log(`  - ${label}: removed`);
}

function ensureCopy(src, dst, label) {
  if (!existsAt(src)) {
    console.log(`  - ${label}: skip (source missing)`);
    return { action: 'skip', reason: 'src-missing' };
  }
  if (existsAt(dst)) {
    console.log(`  - ${label}: ok (already present)`);
    return { action: 'skip', reason: 'already-present' };
  }
  if (CHECK_ONLY) {
    console.log(`  - ${label}: would copy from ${src}`);
    return { action: 'would-copy' };
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`  - ${label}: copied`);
  return { action: 'copied' };
}

function main() {
  const worktree = path.resolve(positional[0] || process.cwd());

  if (!existsAt(path.join(worktree, '.git'))) {
    fail(`not a git worktree: ${worktree}`);
  }

  const mainRepo = resolveMainWorktree(worktree);
  if (path.resolve(mainRepo) === path.resolve(worktree)) {
    fail(
      'this is the main worktree, not a linked worktree. ' +
      'setup-worktree only runs in linked worktrees.'
    );
  }

  const mode = TEARDOWN
    ? (CHECK_ONLY ? 'teardown check (read-only)' : 'teardown')
    : (CHECK_ONLY ? 'check (read-only)' : 'apply');
  console.log(`platform:  ${process.platform}`);
  console.log(`worktree:  ${worktree}`);
  console.log(`main repo: ${mainRepo}`);
  console.log(`mode:      ${mode}`);
  console.log('');

  if (TEARDOWN) {
    console.log('node_modules:');
    for (const sub of NODE_MODULES_DIRS) {
      const link = path.join(worktree, sub, 'node_modules');
      const label = path.posix.join(sub || '.', 'node_modules');
      removeLink(link, label);
    }
    console.log('generated artifacts:');
    for (const rel of GENERATED_DIRS) {
      removeLink(path.join(worktree, rel), rel);
    }
    console.log('env files:');
    for (const rel of ENV_FILES) {
      removeCopiedFile(path.join(worktree, rel), rel);
    }
    console.log('');
    if (CHECK_ONLY) {
      console.log('teardown check complete. Re-run without --check to apply.');
      return;
    }
    console.log('Teardown complete. Now safe to run `git worktree remove`.');
    return;
  }

  console.log('node_modules:');
  for (const sub of NODE_MODULES_DIRS) {
    const target = path.join(mainRepo, sub, 'node_modules');
    const link = path.join(worktree, sub, 'node_modules');
    const label = path.posix.join(sub || '.', 'node_modules');
    ensureLink(target, link, label);
  }

  console.log('generated artifacts:');
  for (const rel of GENERATED_DIRS) {
    const target = path.join(mainRepo, rel);
    const link = path.join(worktree, rel);
    ensureLink(target, link, rel);
  }

  console.log('env files:');
  for (const rel of ENV_FILES) {
    const src = path.join(mainRepo, rel);
    const dst = path.join(worktree, rel);
    ensureCopy(src, dst, rel);
  }

  console.log('');
  if (CHECK_ONLY) {
    console.log('check complete. Re-run without --check to apply.');
    return;
  }
  console.log('Worktree is ready for tests / typecheck / lint.');
  console.log('REMINDER: do NOT run npm/bun/pnpm install in this worktree.');
  console.log('          Dependency installs belong in the main worktree.');
  console.log('          Before deleting this worktree, run with --teardown.');
}

main();
