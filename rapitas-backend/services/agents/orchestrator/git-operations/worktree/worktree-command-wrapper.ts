/**
 * WorktreeCommandWrapper
 *
 * Provisions `scripts/run-checked.cjs` inside a generated project's worktree so
 * the heartbeat/exit-code wrapper every agent prompt instructs them to use is
 * actually executable there.
 * Not responsible for dependencies (dependency-installer.ts) or for deciding
 * which commands an agent runs.
 */

import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { appendExcludeBlock, resolveExcludeFile } from '../core/git-exclude';

/** Path of the wrapper inside a worktree, and the exclude entry that hides it. */
export const WRAPPER_RELATIVE_PATH = 'scripts/run-checked.cjs';

/**
 * Where the wrapper writes each command's full log. Local evidence for one
 * run, never part of the project: task 1511 (2026-11-21) merged a trendline
 * PR whose only file was one of these logs.
 */
export const VERIFICATION_LOGS_PATTERN = '.verification-logs/';

/**
 * Workflow artifacts an agent sometimes writes to disk at the repository
 * root. They live in the WorkflowFile table; on disk they are strays, and
 * task 1512 (2026-11-21) committed question.md into trendline. Root-anchored,
 * so a project's own docs/plan.md is untouched, and an exclude never hides a
 * file the project already tracks.
 */
export const WORKFLOW_ARTIFACT_PATTERNS: readonly string[] = [
  '/question.md',
  '/research.md',
  '/plan.md',
  '/verify.md',
];

/** Everything a worktree's local exclude list must hide, wrapper aside. */
const RUN_ARTIFACT_PATTERNS = [VERIFICATION_LOGS_PATTERN, ...WORKFLOW_ARTIFACT_PATTERNS];

/**
 * rapitas's own copy of the wrapper. Derived from this module's location so it
 * follows the checkout rather than an absolute path baked into a config.
 *
 * @param moduleDir - Directory of the calling module / 呼び出し元モジュールのディレクトリ
 * @returns Absolute path to rapitas's wrapper / rapitas 同梱ラッパーの絶対パス
 */
export function defaultWrapperSource(moduleDir: string): string {
  // worktree → git-operations → orchestrator → agents → services → rapitas-backend → repo root
  return resolve(moduleDir, '../../../../../..', WRAPPER_RELATIVE_PATH);
}

/** What ensureRunCheckedWrapper did, for logging. */
export type WrapperAction = 'copied' | 'present' | 'source-missing';

/**
 * Make `node scripts/run-checked.cjs` work inside a worktree.
 *
 * NOTE: Why this exists — every implementer and verifier prompt carries
 * shellExitCodeSafetyRule, which tells the agent to run verification through
 * `node scripts/run-checked.cjs`. That script ships with rapitas and does NOT
 * exist in a generated project, so agents there ran raw commands instead. The
 * wrapper is also the only thing that prints a heartbeat line every 30s, and
 * Claude Code kills an agent after ~301 seconds with no output: a first-time
 * dependency install, a Playwright browser download or a long test run would
 * silence the agent past that limit and get it killed mid-write, which is how
 * truncated/garbled verify.md bodies were produced in the first place.
 *
 * The copy is excluded via the repository's local exclude list rather than left
 * untracked, so an agent running `git add .` cannot commit rapitas's internal
 * tooling into the generated app's repository.
 *
 * @param worktreePath - Worktree root to provision / 対象 worktree のルート
 * @param source - Wrapper to copy; defaults to rapitas's own / コピー元（既定は rapitas 同梱）
 * @returns What was done / 実施内容
 */
export async function ensureRunCheckedWrapper(
  worktreePath: string,
  source: string,
): Promise<WrapperAction> {
  const destination = join(worktreePath, WRAPPER_RELATIVE_PATH);
  if (existsSync(destination)) {
    // A wrapper already in place still writes logs, so they are excluded too.
    await excludeQuietly(worktreePath, RUN_ARTIFACT_PATTERNS);
    return 'present';
  }
  if (!existsSync(source)) return 'source-missing';

  await fsPromises.mkdir(dirname(destination), { recursive: true });
  const content = await fsPromises.readFile(source, 'utf8');
  await fsPromises.writeFile(destination, withLintDisabled(content), 'utf8');
  await excludeQuietly(worktreePath, [WRAPPER_RELATIVE_PATH, ...RUN_ARTIFACT_PATTERNS]);
  return 'copied';
}

/**
 * Put `/* eslint-disable *\/` at the top of the copy, after a shebang line.
 *
 * NOTE: The git exclude hides the copy from commits but not from the
 * project's `eslint .`. TempoRaid task 1347's `pnpm lint` failed with four
 * errors, all `require()` in this CommonJS wrapper inside an ESM project, and
 * the implementer stopped to ask (2026-11-23). The wrapper is rapitas's
 * tooling, so the project's lint has nothing to say about it.
 */
function withLintDisabled(content: string): string {
  const header = '/* eslint-disable */\n';
  if (!content.startsWith('#!')) return header + content;
  const end = content.indexOf('\n');
  if (end === -1) return `${content}\n${header}`;
  return content.slice(0, end + 1) + header + content.slice(end + 1);
}

/** Add patterns to the repository's local exclude list, ignoring failures. */
async function excludeQuietly(worktreePath: string, patterns: readonly string[]): Promise<void> {
  const excludeFile = resolveExcludeFile(worktreePath);
  if (!excludeFile) return;
  try {
    await appendExcludeBlock(
      excludeFile,
      'Provisioned by rapitas so agents can run verification with a heartbeat.',
      patterns,
    );
  } catch {
    // An unwritable exclude file is not worth failing the bootstrap over: the
    // wrapper still works, it is merely visible to `git status`.
  }
}
