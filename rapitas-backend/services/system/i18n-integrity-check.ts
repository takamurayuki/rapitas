/**
 * I18nIntegrityCheck
 *
 * Detects and heals a specific recurring corruption: the primary checkout's
 * `rapitas-frontend/messages/{ja,en}.json` working-tree copies silently
 * revert to an older, key-poorer snapshot with no accompanying commit (only
 * these two files show as modified in `git status`). Root cause unidentified
 * (see concern #10168) — this module treats the SYMPTOM: it restores a file
 * from HEAD only when the working tree is a strict, value-preserving SUBSET
 * of HEAD's content, so it can never discard real in-progress edits.
 * Not responsible for scheduling — see i18n-integrity-scheduler.ts.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../config/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('i18n-integrity-check');

/** The files this check watches, relative to the repo root. */
export const GUARDED_MESSAGE_FILES = [
  'rapitas-frontend/messages/ja.json',
  'rapitas-frontend/messages/en.json',
] as const;

/**
 * Flatten a parsed JSON value into leaf key-path → JSON-stringified-value
 * pairs, so structurally-equal values compare equal regardless of source
 * whitespace/formatting (e.g. a reformatted `dayLabels` array).
 *
 * @param value - Parsed JSON value to flatten. / 走査対象の値
 * @param prefix - Dot-joined key path accumulated so far. / これまでのキー経路
 * @param out - Map leaf paths are written into. / 出力先マップ
 * @returns The same map, for chaining. / 呼び出し元へ返す同じマップ
 */
function flattenLeaves(
  value: unknown,
  prefix = '',
  out: Map<string, string> = new Map(),
): Map<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenLeaves(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

/**
 * Whether `workingContent` is safe to silently overwrite with `headContent`:
 * every leaf key it has must exist in `headContent` with an identical value,
 * and it must be missing at least one leaf key `headContent` has. A working
 * tree with ANY new or differing leaf is real (possibly uncommitted) work and
 * must never be auto-restored over.
 *
 * @param headContent - HEAD's raw JSON text for the file. / HEAD側の生JSON文字列
 * @param workingContent - Working tree's raw JSON text for the file. / 作業ツリー側の生JSON文字列
 * @returns Whether restoring from HEAD is safe. / 復元してよいか
 */
export function isSafeToRestoreFromHead(headContent: string, workingContent: string): boolean {
  let head: unknown;
  let working: unknown;
  try {
    head = JSON.parse(headContent);
    working = JSON.parse(workingContent);
  } catch {
    // Never touch a file we cannot parse — could be a legitimate in-progress edit.
    return false;
  }
  const headLeaves = flattenLeaves(head);
  const workingLeaves = flattenLeaves(working);
  // Working tree has as many or more leaves than HEAD — nothing missing to
  // heal, or it has genuinely new content. Either way, do not touch it.
  if (workingLeaves.size >= headLeaves.size) return false;
  for (const [key, value] of workingLeaves) {
    if (headLeaves.get(key) !== value) return false;
  }
  return true;
}

/** Outcome of checking one guarded file. */
export type FileCheckOutcome = 'healed' | 'drifted_unsafe' | 'ok' | 'error';

/** Collaborators, injectable for tests. */
export interface I18nIntegrityDeps {
  /** Read a file's content at HEAD (e.g. via `git show HEAD:<relPath>`). */
  readHeadContent: (cwd: string, relPath: string) => Promise<string>;
  /** Read the working tree's current content for the file. */
  readWorkingContent: (cwd: string, relPath: string) => Promise<string>;
  /** Overwrite the working tree's file content. */
  writeWorkingContent: (cwd: string, relPath: string, content: string) => Promise<void>;
}

const defaultDeps: I18nIntegrityDeps = {
  readHeadContent: async (cwd, relPath) => {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relPath}`], { cwd });
    return stdout;
  },
  readWorkingContent: (cwd, relPath) => readFile(join(cwd, relPath), 'utf8'),
  writeWorkingContent: (cwd, relPath, content) => writeFile(join(cwd, relPath), content, 'utf8'),
};

/**
 * Check one guarded file against HEAD and restore it when the drift is a
 * safe, pure subtraction (see {@link isSafeToRestoreFromHead}).
 *
 * @param cwd - Repository root. / リポジトリルート
 * @param relPath - File path relative to `cwd`. / cwdからの相対パス
 * @param deps - Test overrides. / テスト用差し替え
 * @returns What happened for this file. / この1ファイルの結果
 */
export async function checkAndHealMessagesFile(
  cwd: string,
  relPath: string,
  deps: Partial<I18nIntegrityDeps> = {},
): Promise<FileCheckOutcome> {
  const d: I18nIntegrityDeps = { ...defaultDeps, ...deps };

  let headContent: string;
  try {
    headContent = await d.readHeadContent(cwd, relPath);
  } catch (err) {
    log.warn(
      { err, relPath },
      '[i18n-integrity] reading HEAD content failed — skipping this cycle',
    );
    return 'error';
  }

  let workingContent: string;
  try {
    workingContent = await d.readWorkingContent(cwd, relPath);
  } catch (err) {
    log.warn({ err, relPath }, '[i18n-integrity] reading working tree file failed');
    return 'error';
  }

  if (workingContent === headContent) return 'ok';

  if (!isSafeToRestoreFromHead(headContent, workingContent)) {
    // Drifted, but NOT a pure subtraction — could be real uncommitted work.
    // Alert only; never overwrite.
    log.warn(
      { relPath },
      '[i18n-integrity] working tree drifted from HEAD but is not a safe, value-preserving subset — leaving untouched',
    );
    return 'drifted_unsafe';
  }

  await d.writeWorkingContent(cwd, relPath, headContent);
  log.warn(
    { relPath },
    '[i18n-integrity] working tree had silently reverted to a key-poorer snapshot — restored from HEAD',
  );
  return 'healed';
}

/**
 * Check and heal every guarded file.
 *
 * @param cwd - Repository root. / リポジトリルート
 * @param deps - Test overrides. / テスト用差し替え
 * @returns Per-file outcomes, keyed by relative path. / ファイルごとの結果
 */
export async function checkAndHealAllMessagesFiles(
  cwd: string,
  deps: Partial<I18nIntegrityDeps> = {},
): Promise<Record<string, FileCheckOutcome>> {
  const results: Record<string, FileCheckOutcome> = {};
  for (const relPath of GUARDED_MESSAGE_FILES) {
    results[relPath] = await checkAndHealMessagesFile(cwd, relPath, deps);
  }
  return results;
}
