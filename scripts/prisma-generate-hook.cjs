#!/usr/bin/env node
/**
 * prisma-generate-hook.cjs
 *
 * lint-staged hook that regenerates the Prisma Client whenever a
 * `rapitas-backend/prisma/**\/*.prisma` file is staged for commit, so the
 * generated client in `node_modules/.prisma/client/` never drifts from the
 * schema a commit introduces.
 *
 * It is NOT responsible for `prisma db push`/migrations — only client
 * generation. lint-staged passes the matched .prisma paths as argv; they are
 * ignored because `prisma generate` reads the whole schema folder, not a single
 * file.
 *
 * Usage (wired from package.json lint-staged):
 *   "rapitas-backend/prisma/**\/*.prisma": ["node scripts/prisma-generate-hook.cjs"]
 *
 * Exit code: non-zero if generation fails, which aborts the commit.
 */
'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'rapitas-backend');

/**
 * Run a command in the backend directory, streaming its output so the
 * "prisma generate" run is visible in the lint-staged log.
 *
 * @param {string} command - Shell command to execute. / 実行するコマンド
 * @returns {boolean} True when the command exited 0. / 成功時 true
 */
function run(command) {
  try {
    execSync(command, { cwd: BACKEND_DIR, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

console.log('🔧 prisma-generate-hook: .prisma change staged — running prisma generate');

// Prefer the project's own script (bun is the backend's runtime); fall back to
// npx so the hook still works in environments without bun on PATH (e.g. CI).
const ok = run('bun run db:generate') || run('npx --yes prisma generate');

if (!ok) {
  console.error('❌ prisma-generate-hook: prisma generate failed — aborting commit.');
  process.exit(1);
}

console.log('✅ prisma-generate-hook: Prisma Client regenerated.');
