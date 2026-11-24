/**
 * confirm-link-store
 *
 * File-backed state for external confirm links (task 1430): `links.json`
 * (issue / one-shot reservation / revocation) and `resource-tags.json` (the
 * 「外部公開可」 tag per resource). File-based on purpose — a Prisma model
 * would need a schema push and a server restart, the same call as
 * plan-deviation/operation-store.ts. Not responsible for tokens or audit.
 */
import { existsSync, mkdirSync } from 'fs';
import { readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getCycleLogFilePath } from '../../observability/cycle-event-logger';

/** Lifecycle of one link. `answering` is consumed: it is never re-opened by a reader. */
export type ConfirmLinkState = 'active' | 'answering' | 'answered' | 'revoked';

/** Tag that marks a resource as visible through a confirm link. */
export const EXTERNAL_PUBLIC_TAG = 'external_public';

const PURGE_AFTER_EXPIRY_MS = 7 * 86_400_000;

/** One issued link. */
export interface ConfirmLinkRecord {
  linkId: string;
  taskId: number;
  /** `WorkflowTransition.id` of the pause the link answers. / 対象の質問の遷移ID */
  pauseTransitionId: number;
  questionId: string;
  optionKeys: string[];
  /**
   * SHA-256 of question.md at issue time. A re-saved question no longer
   * matches, so the old link cannot answer a new decision. / 発行時の質問の版
   */
  questionDigest: string;
  /** Request text the issuer typed; question.md itself is never shown. / 依頼文 */
  message: string;
  issuedAt: number;
  expiresAt: number;
  state: ConfirmLinkState;
  answeredAt?: number;
  revokedReason?: string;
}

/** Store operations. Every write runs inside one per-directory mutex. */
export interface ConfirmLinkStore {
  issue(record: ConfirmLinkRecord, now: number): Promise<void>;
  get(linkId: string): Promise<ConfirmLinkRecord | null>;
  list(taskId: number): Promise<ConfirmLinkRecord[]>;
  reserve(linkId: string, now: number): Promise<boolean>;
  markAnswered(linkId: string, now: number): Promise<void>;
  revoke(linkId: string, reason: string): Promise<void>;
  release(linkId: string): Promise<void>;
  getResourceTags(): Promise<Record<string, string[]>>;
  setResourceTag(resourceId: number, externalPublic: boolean): Promise<void>;
}

/** Options for {@link createConfirmLinkStore}. */
export interface ConfirmLinkStoreOptions {
  /** Directory holding the two JSON files (tests inject a temp dir). / 保存先 */
  dir: string;
  /** Test hook run inside the lock just before a write. / テスト用の遅延注入 */
  beforeWrite?: () => Promise<void>;
}

// Keyed by directory so two store instances on the same files share a lock.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(dir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    dir,
    next.catch(() => undefined),
  );
  return next;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

/**
 * Default directory: `confirm-links/` next to the daily cycle logs.
 *
 * @returns The directory path / 保存先ディレクトリ
 */
export function getDefaultConfirmLinkDir(): string {
  return join(dirname(getCycleLogFilePath()), 'confirm-links');
}

/**
 * Create a store over `<dir>/links.json` and `<dir>/resource-tags.json`.
 *
 * @param options - Directory and optional test hook / 保存先とテスト用フック
 * @returns The store / ストア
 */
export function createConfirmLinkStore(options: ConfirmLinkStoreOptions): ConfirmLinkStore {
  const { dir, beforeWrite } = options;
  const linksPath = join(dir, 'links.json');
  const tagsPath = join(dir, 'resource-tags.json');

  const readLinks = async () =>
    (await readJson<{ links: ConfirmLinkRecord[] }>(linksPath, { links: [] })).links;
  const writeLinks = async (links: ConfirmLinkRecord[]) => {
    if (beforeWrite) await beforeWrite();
    await writeJsonAtomic(linksPath, { links });
  };

  /** Read-modify-write one link under the lock; `mutate` returns false to skip the write. */
  const update = (
    linkId: string,
    mutate: (link: ConfirmLinkRecord, links: ConfirmLinkRecord[]) => boolean,
  ) =>
    withLock(dir, async () => {
      const links = await readLinks();
      const link = links.find((l) => l.linkId === linkId);
      if (!link || !mutate(link, links)) return false;
      await writeLinks(links);
      return true;
    });

  return {
    issue: (record, now) =>
      withLock(dir, async () => {
        const kept = (await readLinks()).filter((l) => l.expiresAt + PURGE_AFTER_EXPIRY_MS > now);
        for (const l of kept) {
          if (l.taskId === record.taskId && l.state === 'active') {
            l.state = 'revoked';
            l.revokedReason = 'reissued';
          }
        }
        kept.push(record);
        await writeLinks(kept);
      }),
    get: async (linkId) => (await readLinks()).find((l) => l.linkId === linkId) ?? null,
    list: async (taskId) => (await readLinks()).filter((l) => l.taskId === taskId),
    reserve: (linkId, now) =>
      update(linkId, (l) => {
        if (l.state !== 'active' || now >= l.expiresAt) return false;
        l.state = 'answering';
        return true;
      }),
    markAnswered: async (linkId, now) => {
      await update(linkId, (l) => {
        l.state = 'answered';
        l.answeredAt = now;
        return true;
      });
    },
    revoke: async (linkId, reason) => {
      // Idempotent, and an answered link keeps its answer on record.
      await update(linkId, (l) => {
        if (l.state === 'answered' || l.state === 'revoked') return false;
        l.state = 'revoked';
        l.revokedReason = reason;
        return true;
      });
    },
    release: async (linkId) => {
      await update(linkId, (l, links) => {
        if (l.state !== 'answering') return false;
        // A newer link for the task was issued while this one was reserved:
        // reopening it would leave two usable links for one decision (Q3).
        if (links.some((o) => o.taskId === l.taskId && o.issuedAt > l.issuedAt)) {
          l.state = 'revoked';
          l.revokedReason = 'reissued';
        } else {
          l.state = 'active';
        }
        return true;
      });
    },
    getResourceTags: () => readJson<Record<string, string[]>>(tagsPath, {}),
    setResourceTag: (resourceId, externalPublic) =>
      withLock(dir, async () => {
        const tags = await readJson<Record<string, string[]>>(tagsPath, {});
        const key = String(resourceId);
        if (externalPublic) tags[key] = [EXTERNAL_PUBLIC_TAG];
        else delete tags[key];
        await writeJsonAtomic(tagsPath, tags);
      }),
  };
}
