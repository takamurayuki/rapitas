/**
 * requirements-document-reader
 *
 * Reads a generated project's `docs/requirements.md`, preferring the branch the
 * document is authoritative on over whatever the working tree happens to hold.
 * Not responsible for parsing it or deciding what to do with it — that is the
 * intake job's and services/organization/'s job.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../config/logger';

const log = createLogger('scheduling:requirements-reader');

// NOTE: execFile (array-args, no shell) so a theme's branch name cannot be
// interpreted as shell syntax. See services/github/gh-client.ts for the pattern.
const execFileAsync = promisify(execFile);

/** Requirements documents are tens of KiB; anything larger is not one. */
export const MAX_REQUIREMENTS_BYTES = 512 * 1024;

/** How long a git read may take before the working tree is used instead. */
const GIT_READ_TIMEOUT_MS = 20_000;

/** Reject a document that is too large to be one. */
function withinSizeLimit(content: string, source: string): string | null {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_REQUIREMENTS_BYTES) {
    log.warn({ source, bytes }, 'requirements.md too large — skipping');
    return null;
  }
  return content;
}

/**
 * Read the document from `origin/<branch>`, the branch it is authoritative on.
 *
 * NOTE: Reading the working tree is the trap this avoids. A project's main
 * checkout only advances when something pulls, and nothing in the job does:
 * measured 2026-10-11, rapitas's own checkout sat SEVEN commits behind origin
 * and temporaid's three, and reading the stale copy led to a wrong conclusion
 * twice in one session. `git fetch` runs first, because `origin/<branch>` is
 * itself only as fresh as the last fetch against that remote.
 *
 * @param workingDirectory - Repository to read from / 読み取り元リポジトリ
 * @param branch - Authoritative branch / 正となるブランチ
 * @returns Content, or null when git cannot provide it / git で取得できなければ null
 */
async function readFromOrigin(
  workingDirectory: string,
  branch: string,
  relativePath: string,
): Promise<string | null> {
  const run = (args: string[]) =>
    execFileAsync('git', args, {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: GIT_READ_TIMEOUT_MS,
      maxBuffer: MAX_REQUIREMENTS_BYTES * 2,
    });

  try {
    // A failed fetch is not fatal: the existing origin ref may still be newer
    // than the working tree, which is the comparison that matters here.
    await run(['fetch', 'origin', branch, '--quiet']).catch((err) => {
      log.debug({ err, workingDirectory, branch }, 'fetch failed; using the existing origin ref');
    });
    const { stdout } = await run(['show', `origin/${branch}:${relativePath}`]);
    return withinSizeLimit(stdout, `origin/${branch}:${relativePath}`);
  } catch (err) {
    log.debug({ err, workingDirectory, branch, relativePath }, 'origin read unavailable');
    return null;
  }
}

/**
 * Read a theme's requirements document, preferring the authoritative branch.
 *
 * Falls back to the working tree so a project without a remote (or a fresh one
 * whose first push has not happened) still works — but says so, because a
 * working-tree read may be arbitrarily out of date.
 *
 * @param workingDirectory - Theme working directory / テーマの作業ディレクトリ
 * @param defaultBranch - Branch the documents are authoritative on / 正となるブランチ
 * @returns Content, or null when missing, oversized or unreadable / 取得不能なら null
 */
export async function readRequirementsFile(
  workingDirectory: string,
  defaultBranch?: string | null,
): Promise<string | null> {
  return readProjectDoc(workingDirectory, 'requirements.md', defaultBranch);
}

/**
 * Read `docs/design.md` the same way — authoritative branch first.
 *
 * The design document is what the environment-setup task quotes its technical
 * stack from, so reading a stale working tree would hand the agent the wrong
 * stack as if it were decided.
 *
 * @param workingDirectory - Theme working directory / テーマの作業ディレクトリ
 * @param defaultBranch - Branch the documents are authoritative on / 正となるブランチ
 * @returns Content, or null when missing, oversized or unreadable / 取得不能なら null
 */
export async function readDesignFile(
  workingDirectory: string,
  defaultBranch?: string | null,
): Promise<string | null> {
  return readProjectDoc(workingDirectory, 'design.md', defaultBranch);
}

/**
 * Read one `docs/<fileName>`, preferring the authoritative branch.
 *
 * Falls back to the working tree so a project without a remote (or a fresh one
 * whose first push has not happened) still works — but says so, because a
 * working-tree read may be arbitrarily out of date.
 *
 * @param workingDirectory - Theme working directory / テーマの作業ディレクトリ
 * @param fileName - File under `docs/` / docs 配下のファイル名
 * @param defaultBranch - Branch the documents are authoritative on / 正となるブランチ
 * @returns Content, or null when missing, oversized or unreadable / 取得不能なら null
 */
export async function readProjectDoc(
  workingDirectory: string,
  fileName: string,
  defaultBranch?: string | null,
): Promise<string | null> {
  const branch = defaultBranch?.trim();
  if (branch) {
    const fromOrigin = await readFromOrigin(workingDirectory, branch, `docs/${fileName}`);
    if (fromOrigin !== null) return fromOrigin;
  }

  const file = join(workingDirectory, 'docs', fileName);
  // One syscall, not three: an existsSync() and a stat() ahead of the read
  // could each see a different file, and readFile already rejects a missing
  // path with ENOENT and a directory with EISDIR — the two cases the checks
  // existed to catch. Both become the same null in the catch below.
  try {
    const content = await readFile(file, 'utf8');
    log.info(
      { file, fileName, branch: branch ?? '(none)' },
      'Read the document from the working tree; it may be behind origin',
    );
    return withinSizeLimit(content, file);
  } catch (err) {
    // A missing document is the normal case for a repo without docs/, and a
    // directory where the file should be is the isFile() check that used to
    // sit above. Neither is worth a warn.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') return null;
    log.warn({ err, file }, 'requirements.md unreadable — skipping');
    return null;
  }
}

/**
 * Whether a file exists at the project ROOT on the authoritative branch.
 *
 * NOTE: the authoritative branch, not the working tree — the asymmetry was a
 * deadlock. Measured 2026-10-12: task #1212 produced `rapitas.runtime.json`,
 * verified it, and pushed it on `feature/t1212-update-config`. The intake read
 * its documents from `origin/develop` but looked for the config in the main
 * checkout, which nothing pulls, so the project counted as "still needs
 * setting up" forever while the `[ENV]` title suppressed re-filing — feature
 * tasks were held with no error anywhere. The working tree stays as a fallback
 * for a project with no remote.
 *
 * @param workingDirectory - Theme working directory / テーマの作業ディレクトリ
 * @param fileName - File at the repository root / リポジトリ直下のファイル名
 * @param defaultBranch - Branch the project is authoritative on / 正となるブランチ
 * @returns True when the file is present / 存在すれば true
 */
export async function hasProjectRootFile(
  workingDirectory: string,
  fileName: string,
  defaultBranch?: string | null,
): Promise<boolean> {
  const branch = defaultBranch?.trim();
  if (branch) {
    const fromOrigin = await readFromOrigin(workingDirectory, branch, fileName);
    if (fromOrigin !== null) return true;
  }
  return existsSync(join(workingDirectory, fileName));
}
