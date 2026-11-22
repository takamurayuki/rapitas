'use strict';
/**
 * orphan-worktree-trees.test
 *
 * Encodes trendline task 514's leftover dev stack (2026-11-20): an orphaned
 * `node scripts\dev-all.mjs 3100` whose children were worktree programs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findOrphanWorktreeTrees } = require('./orphan-worktree-trees.cjs');

const WT = 'C:\\Projects\\trendline\\.worktrees\\task-514';
const p = (pid, ppid, name, cmd = '', exe = '') => ({
  ProcessId: pid,
  ParentProcessId: ppid,
  Name: name,
  CommandLine: cmd,
  ExecutablePath: exe,
});

test('finds an orphaned root whose children run worktree programs', () => {
  const snap = [
    p(34064, 10752, 'node.exe', 'node  scripts\\dev-all.mjs "3100"', 'C:\\nvm4w\\nodejs\\node.exe'),
    p(33936, 34064, 'server.exe', `${WT}\\server.exe`, `${WT}\\server.exe`),
    p(
      26916,
      34064,
      'node.exe',
      `"node" "${WT}\\web\\node_modules\\.bin\\..\\next\\dist\\bin\\next" dev -p 3100`,
    ),
  ];
  assert.deepEqual(findOrphanWorktreeTrees(snap), [34064]);
});

test('leaves a tree whose parent is alive', () => {
  const snap = [
    p(1, 0, 'explorer.exe'),
    p(34064, 1, 'node.exe', 'node scripts\\dev-all.mjs'),
    p(33936, 34064, 'server.exe', '', `${WT}\\server.exe`),
  ];
  assert.deepEqual(findOrphanWorktreeTrees(snap), []);
});

test('never touches an interactive session, even when its shells name a worktree', () => {
  const snap = [
    p(25932, 28604, 'claude.exe', 'claude.exe --bg-pty-host'),
    p(
      35360,
      25932,
      'bash.exe',
      `bash -c "cd ${WT} && ls"`,
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    ),
    p(400, 35360, 'server.exe', '', `${WT}\\server.exe`),
  ];
  assert.deepEqual(findOrphanWorktreeTrees(snap), []);
});

test('a mention of a worktree in a command line is not a worktree program', () => {
  const snap = [p(500, 9999, 'bash.exe', `bash -c "cat ${WT}\\README.md"`, 'C:\\Git\\bash.exe')];
  assert.deepEqual(findOrphanWorktreeTrees(snap), []);
});

test('skips pids the caller keeps (dev.js, the live backend)', () => {
  const snap = [
    p(700, 9999, 'node.exe', 'node dev-all.mjs'),
    p(701, 700, 'server.exe', '', `${WT}\\server.exe`),
  ];
  assert.deepEqual(findOrphanWorktreeTrees(snap, new Set([700])), []);
});

test('never takes explorer (an orphan on Windows) or a desktop app as a root or inside a tree', () => {
  const snap = [
    p(1, 0, 'explorer.exe'),
    p(2, 1, 'Code.exe'),
    p(3, 2, 'node.exe', `"node" "${WT}\\web\\node_modules\\next\\dist\\bin\\next" dev`),
    p(10, 9999, 'cmd.exe', 'cmd /c start'),
    p(11, 10, 'WindowsTerminal.exe'),
    p(12, 11, 'server.exe', '', `${WT}\\server.exe`),
  ];
  assert.deepEqual(findOrphanWorktreeTrees(snap), []);
});

// 2026-11-23 06:30: TempoRaid task 1347's runtime preview was started by the
// standalone pnpm binary. ROOT_KIND had no pnpm, so the orphaned tree
// (pnpm → cmd → node vite) was never a candidate; it held :3001 as a ghost
// socket and dev.js gave up after 20 retries.
test('takes an orphaned standalone pnpm as a root', () => {
  const TR = 'C:\\Projects\\temporaid\\.worktrees\\task-1347-b7010d72';
  const snap = [
    p(
      15424,
      6408,
      'pnpm.exe',
      '"C:\\Users\\u\\AppData\\Local\\pnpm\\pnpm.exe" -C apps/web run dev --host 127.0.0.1 --port 53827 --strictPort',
    ),
    p(25868, 15424, 'cmd.exe', 'cmd.exe /d /s /c vite --host 127.0.0.1 --port 53827 --strictPort'),
    p(
      8744,
      25868,
      'node.exe',
      `node "${TR}\\apps\\web\\node_modules\\.bin\\..\\vite\\bin\\vite.js" --host 127.0.0.1`,
    ),
  ];
  assert.deepEqual(findOrphanWorktreeTrees(snap), [15424]);
});
