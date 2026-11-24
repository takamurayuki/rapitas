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

/**
 * Append one entry and drop lines past the retention window.
 *
 * @param entry - The accepted answer / 記録する回答
 * @param options - Audit directory and current time / 保存先と現在時刻
 */
export function appendConfirmLinkAudit(
  entry: ConfirmLinkAuditEntry,
  options: ConfirmLinkAuditOptions,
): Promise<void> {
  const run = async () => {
    const now = options.now ?? Date.now();
    const cutoff = now - CONFIRM_LINK_AUDIT_RETENTION_MS;
    const kept = (await readConfirmLinkAudit(options)).filter((e) => Date.parse(e.at) >= cutoff);
    kept.push(entry);
    if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true });
    const path = join(options.dir, 'audit.ndjson');
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    await rename(tmp, path);
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}
