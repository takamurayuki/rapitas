'use strict';
/**
 * orphan-worktree-trees
 *
 * Finds process trees left behind by a backend agent run: an orphaned root
 * (its parent is gone) whose subtree runs a program from a task worktree.
 * Pure — dev.js takes the snapshot and does the kill.
 *
 * NOTE: The per-process rule in dev.js (".worktrees in the command line AND
 * parent dead") missed trendline task 514's dev stack (2026-11-20): the root
 * was `node scripts\dev-all.mjs 3100` (relative path, no .worktrees), and the
 * worktree programs under it (server.exe, worker.exe, next) still had a live
 * parent. The stack held port 3100 and the dead backend's :3001 handle — a
 * ghost socket that took the app down until it was killed by hand.
 */

/** A program started from a task worktree: its binary, or node running a worktree module. */
const WORKTREE_PROGRAM = /[\\/]\.worktrees[\\/]/i;

/**
 * Whether a process runs a program that lives in a task worktree.
 * Judged by the executable path, or by node's script path, never by a mere
 * mention: an interactive session's shell can name a worktree in its command
 * line without running anything from it.
 *
 * @param {{ Name?: string, CommandLine?: string, ExecutablePath?: string }} p
 * @returns {boolean}
 */
function runsWorktreeProgram(p) {
  if (WORKTREE_PROGRAM.test(p.ExecutablePath || '')) return true;
  if (/^node\.exe$/i.test(p.Name || '')) {
    return /[\\/]\.worktrees[\\/][^"]*[\\/]node_modules[\\/]/i.test(p.CommandLine || '');
  }
  return false;
}

/**
 * Processes whose tree is never touched: a person's session and their desktop
 * apps. explorer.exe is the reason this exists — on Windows its parent has
 * usually exited, so it is an "orphan" whose subtree holds everything the
 * person launched, worktree dev servers included.
 */
const PROTECTED = /^(claude|explorer|windowsterminal|wt|code|cursor|devenv|idea64|rider64)\.exe$/i;

/**
 * Only what an agent starts can be a root: a shell, a runtime or a package manager.
 *
 * NOTE: pnpm, yarn and npx ship standalone .exe launchers. TempoRaid task 1347's
 * runtime preview was `pnpm.exe -C apps/web run dev …`; without pnpm here its
 * orphaned tree was never a candidate and held :3001 as a ghost socket until it
 * was stopped by hand (2026-11-23).
 */
const ROOT_KIND =
  /^(node|bun|bash|sh|cmd|powershell|pwsh|go|codex|python|npm|npx|pnpm|pnpx|yarn)\.exe$/i;

function isProtected(p) {
  return PROTECTED.test(p.Name || '');
}

/**
 * Orphaned roots whose subtree runs a worktree program.
 *
 * @param {Array<{ ProcessId: number, ParentProcessId: number, Name?: string,
 *   CommandLine?: string, ExecutablePath?: string }>} processes - Snapshot / スナップショット
 * @param {Set<number>} [keep] - Pids never returned (dev.js, the live backend) / 対象外の PID
 * @returns {number[]} Root pids to kill with their tree / 木ごと止める起点の PID
 */
function findOrphanWorktreeTrees(processes, keep = new Set()) {
  const byPid = new Map(processes.map((p) => [Number(p.ProcessId), p]));
  const children = new Map();
  for (const p of processes) {
    const parent = Number(p.ParentProcessId);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(p);
  }
  const roots = [];
  for (const p of processes) {
    const pid = Number(p.ProcessId);
    if (keep.has(pid) || byPid.has(Number(p.ParentProcessId)) || !ROOT_KIND.test(p.Name || ''))
      continue;
    let hit = false;
    let guarded = false;
    const stack = [p];
    const seen = new Set();
    while (stack.length > 0) {
      const cur = stack.pop();
      const curPid = Number(cur.ProcessId);
      if (seen.has(curPid)) continue;
      seen.add(curPid);
      if (keep.has(curPid) || isProtected(cur)) guarded = true;
      if (runsWorktreeProgram(cur)) hit = true;
      for (const c of children.get(curPid) || []) stack.push(c);
    }
    if (hit && !guarded) roots.push(pid);
  }
  return roots;
}

module.exports = { findOrphanWorktreeTrees, runsWorktreeProgram };
