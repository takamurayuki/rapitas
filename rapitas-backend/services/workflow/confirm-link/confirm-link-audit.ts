/**
 * confirm-link-audit
 *
 * Append-only audit of answers received through an external confirm link
 * (task 1430): one NDJSON line per accepted answer, kept 180 days. Rejected
 * requests are never written here. Not responsible for deciding whether an
 * answer is accepted.
 */
import { existsSync, mkdirSync } from 'fs';
import { readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ConfirmLinkStore } from './confirm-link-store';

/** Audit lines are deleted 180 days after they were written. */
export const CONFIRM_LINK_AUDIT_RETENTION_MS = 180 * 86_400_000;

/** One accepted answer. */
export interface ConfirmLinkAuditEntry {
  id: string;
  /** ISO time the answer was accepted. / 回答日時 */
  at: string;
  linkId: string;
  taskId: number;
  pauseTransitionId: number;
  questionId: string;
  selectedKey: string;
  /** Self-reported, unauthenticated name. / 自己申告の回答者名 */
  respondentName: string;
  /** `external_confirm_link:<linkId>`. / 経路 */
  route: string;
  /** SHA-256 of the question.md the respondent answered. / 回答した質問の版 */
  questionDigest: string;
}

/** Where the audit file lives (tests inject a temp dir). */
export interface ConfirmLinkAuditOptions {
  dir: string;
  now?: number;
}

/**
 * The fixed route name recorded for an answer through a link.
 *
 * @param linkId - Link id / リンクID
 * @returns `external_confirm_link:<linkId>` / 経路名
 */
export function confirmLinkRoute(linkId: string): string {
  return `external_confirm_link:${linkId}`;
}

let chain: Promise<unknown> = Promise.resolve();

/** Serialise every read-modify-write of the audit file in this process. */
function withAuditLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

function parseLines(text: string): ConfirmLinkAuditEntry[] {
  const out: ConfirmLinkAuditEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ConfirmLinkAuditEntry);
    } catch {
      // A torn line is dropped rather than failing every later append.
    }
  }
  return out;
}

/**
 * Read every retained audit entry.
 *
 * @param options - Audit directory / 保存先
 * @returns The entries, oldest first / 監査記録
 */
export async function readConfirmLinkAudit(
  options: ConfirmLinkAuditOptions,
): Promise<ConfirmLinkAuditEntry[]> {
  try {
    return parseLines(await readFile(join(options.dir, 'audit.ndjson'), 'utf8'));
  } catch {
    return [];
  }
}

async function writeEntries(dir: string, entries: ConfirmLinkAuditEntry[]): Promise<void> {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'audit.ndjson');
  const tmp = `${path}.${process.pid}.tmp`;
  const body = entries.map((e) => JSON.stringify(e)).join('\n');
  await writeFile(tmp, body ? `${body}\n` : '', 'utf8');
  await rename(tmp, path);
}

/**
 * Append one entry and drop lines past the retention window. Idempotent: an
 * entry whose `id` is already on file is not written twice.
 *
 * @param entry - The answer about to be applied / 記録する回答
 * @param options - Audit directory and current time / 保存先と現在時刻
 */
export function appendConfirmLinkAudit(
  entry: ConfirmLinkAuditEntry,
  options: ConfirmLinkAuditOptions,
): Promise<void> {
  return withAuditLock(async () => {
    const now = options.now ?? Date.now();
    const cutoff = now - CONFIRM_LINK_AUDIT_RETENTION_MS;
    const kept = (await readConfirmLinkAudit(options)).filter((e) => Date.parse(e.at) >= cutoff);
    if (kept.some((e) => e.id === entry.id)) return;
    kept.push(entry);
    await writeEntries(options.dir, kept);
  });
}

/**
 * Remove one entry by id (compensation when the answer was NOT applied).
 *
 * @param id - Entry id / 監査行のID
 * @param options - Audit directory / 保存先
 */
export function removeConfirmLinkAudit(
  id: string,
  options: ConfirmLinkAuditOptions,
): Promise<void> {
  return withAuditLock(async () => {
    const all = await readConfirmLinkAudit(options);
    const kept = all.filter((e) => e.id !== id);
    if (kept.length !== all.length) await writeEntries(options.dir, kept);
  });
}

/**
 * Drop lines whose compensation was lost (their link is `active` or
 * `revoked`). `isOrphan` runs inside the audit lock, so a line being written
 * by a concurrent answer — whose link is already `answering` — is never
 * judged half-way.
 *
 * @param isOrphan - Whether a line belongs to an unapplied answer / 孤児の判定
 * @param options - Audit directory / 保存先
 * @returns Number of lines dropped / 削除した件数
 */
export function pruneOrphanConfirmLinkAudits(
  isOrphan: (entry: ConfirmLinkAuditEntry) => Promise<boolean>,
  options: ConfirmLinkAuditOptions,
): Promise<number> {
  return withAuditLock(async () => {
    const all = await readConfirmLinkAudit(options);
    const kept: ConfirmLinkAuditEntry[] = [];
    for (const e of all) if (!(await isOrphan(e))) kept.push(e);
    if (kept.length !== all.length) await writeEntries(options.dir, kept);
    return all.length - kept.length;
  });
}

/**
 * Prune one task's orphan lines: an entry is an orphan when its link is
 * `active` or `revoked` (the answer was never applied). A line whose link
 * record is gone is kept — it cannot be judged, so it is not deleted.
 *
 * @param taskId - Task whose lines to inspect / 対象タスク
 * @param store - Link store read inside the audit lock / リンクストア
 * @param options - Audit directory / 保存先
 * @returns Number of lines dropped / 削除した件数
 */
export function pruneTaskOrphanAudits(
  taskId: number,
  store: Pick<ConfirmLinkStore, 'get'>,
  options: ConfirmLinkAuditOptions,
): Promise<number> {
  return pruneOrphanConfirmLinkAudits(async (e) => {
    if (e.taskId !== taskId) return false;
    const link = await store.get(e.linkId);
    return link?.state === 'active' || link?.state === 'revoked';
  }, options);
}
