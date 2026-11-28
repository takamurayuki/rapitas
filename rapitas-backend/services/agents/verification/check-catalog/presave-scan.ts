/**
 * presave-scan
 *
 * The working-tree screens the pre-save stage applies before a local commit:
 * the secret-material scan and the attribution of changed files to this
 * task's own sessions. Lives in the services layer so the self-verifier can
 * run the same screens without committing (task 1602); the pre-save stage
 * (routes/workflow/workflow-auto-commit-presave.ts) imports them from here.
 * Not responsible for staging, committing, or the tamper/scope checks.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../../../../config';

/** Grace for clock skew between the DB session stamp and file mtimes. */
const ATTRIBUTION_GRACE_MS = 60_000;

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Attribute the working-tree changes to this task's own sessions in this
 * worktree: a changed file whose mtime predates the first such session cannot
 * have been produced by the task, and a worktree with no session window
 * cannot be attributed at all. Both hold the save (diff kept, nothing staged).
 *
 * @param p - Task, worktree and the changed paths / 対象
 * @returns Attribution verdict with the unattributable paths / 判定
 */
export async function attributeWorkingTree(p: {
  taskId: number;
  gitCwd: string;
  changedFiles: string[];
}): Promise<{ ok: boolean; unattributed: string[]; windowStart: Date | null }> {
  const sessions = await prisma.agentSession
    .findMany({
      where: { config: { taskId: p.taskId }, worktreePath: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, startedAt: true, worktreePath: true },
    })
    .catch(() => []);
  const own = sessions.filter(
    (s) => s.worktreePath && normPath(s.worktreePath) === normPath(p.gitCwd),
  );
  const first = own[0];
  if (!first) return { ok: false, unattributed: [...p.changedFiles], windowStart: null };
  const windowStart =
    first.startedAt && first.startedAt < first.createdAt ? first.startedAt : first.createdAt;
  const floor = windowStart.getTime() - ATTRIBUTION_GRACE_MS;
  const unattributed: string[] = [];
  for (const rel of p.changedFiles) {
    try {
      const info = await stat(join(p.gitCwd, rel));
      if (info.mtimeMs < floor) unattributed.push(rel);
    } catch {
      // Deleted paths leave no mtime; the deletion itself is part of the diff
      // the checks above already evaluated.
    }
  }
  return { ok: unattributed.length === 0, unattributed, windowStart };
}

/** File names that must never be bulk-staged from an agent worktree. */
const SECRET_PATH_RE =
  /(^|[\\/])(\.env(\.[^\\/]+)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|[^\\/]*credentials[^\\/]*\.(json|ya?ml|txt))$|\.(pem|key|p12|pfx|jks|keystore)$/i;
const SECRET_PATH_ALLOW_RE = /(^|[\\/])\.env\.(example|sample|template)$/i;
/** Token shapes that identify a leaked credential in changed text files. */
const SECRET_CONTENT_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-ant-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abp]-[A-Za-z0-9-]{20,}/;
const SECRET_SCAN_MAX_BYTES = 512 * 1024;
const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|env|txt|md|sh|ps1|ini|cfg|conf|rs)$/i;

/**
 * Paths among `files` that look like secret material: a credential file name,
 * or a known token shape inside a changed text file. A name/token screen only —
 * a floor against bulk-staging credentials, not a complete secret detector.
 *
 * @param gitCwd - Worktree / 対象 worktree
 * @param files - Repo-relative changed paths / 変更パス
 * @returns Paths that look like secrets / 秘密情報らしいパス
 */
export async function scanForSecrets(gitCwd: string, files: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const rel of files) {
    if (SECRET_PATH_RE.test(rel) && !SECRET_PATH_ALLOW_RE.test(rel)) {
      hits.push(rel);
      continue;
    }
    if (!TEXT_EXT_RE.test(rel)) continue;
    const abs = join(gitCwd, rel);
    try {
      const info = await stat(abs);
      if (!info.isFile() || info.size > SECRET_SCAN_MAX_BYTES) continue;
      if (SECRET_CONTENT_RE.test(await readFile(abs, 'utf8'))) hits.push(rel);
    } catch {
      // Deleted or unreadable paths carry nothing to leak.
    }
  }
  return hits;
}
