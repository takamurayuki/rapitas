/**
 * confirm-link-resources
 *
 * Decides which of a task's resources a confirm link may show: the
 * intersection of the task's resources and the 「外部公開可」 tag store.
 * Untagged resources are internal by default. Not responsible for serving
 * bytes — the route streams the file this returns.
 */
import { EXTERNAL_PUBLIC_TAG, type ConfirmLinkStore } from './confirm-link-store';

/** The Resource columns this module reads. */
export interface ConfirmLinkResourceRow {
  id: number;
  taskId: number | null;
  title: string;
  type: string;
  url: string | null;
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
}

/** Dependencies (tests inject the reader). */
export interface ConfirmLinkResourceDeps {
  store: Pick<ConfirmLinkStore, 'getResourceTags'>;
  readResources: (taskId: number) => Promise<ConfirmLinkResourceRow[]>;
}

/** A resource as the public page shows it. File paths never leave the server. */
export interface PublicResourceView {
  id: number;
  title: string;
  /** Present only for http(s) URL resources. / 外部URL */
  url: string | null;
  hasFile: boolean;
}

function isTagged(tags: Record<string, string[]>, id: number): boolean {
  return tags[String(id)]?.includes(EXTERNAL_PUBLIC_TAG) === true;
}

async function taggedRows(
  taskId: number,
  deps: ConfirmLinkResourceDeps,
): Promise<ConfirmLinkResourceRow[]> {
  const [rows, tags] = await Promise.all([
    deps.readResources(taskId),
    deps.store.getResourceTags(),
  ]);
  return rows.filter((r) => r.taskId === taskId && isTagged(tags, r.id));
}

function safeHttpUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * List the public resources of a task.
 *
 * @param taskId - Task the link answers / 対象タスク
 * @param deps - Tag store and resource reader / 依存
 * @returns Tagged resources only / 公開可の資料のみ
 */
export async function listPublicResources(
  taskId: number,
  deps: ConfirmLinkResourceDeps,
): Promise<PublicResourceView[]> {
  return (await taggedRows(taskId, deps)).map((r) => ({
    id: r.id,
    title: r.title,
    url: safeHttpUrl(r.url),
    hasFile: Boolean(r.filePath),
  }));
}

/**
 * Fetch one resource by id, only when it is in the public set of this task.
 *
 * @param taskId - Task the link answers / 対象タスク
 * @param resourceId - Requested id / 要求された資料ID
 * @param deps - Tag store and resource reader / 依存
 * @returns The row, or null when it is not public for this task / 非公開なら null
 */
export async function getPublicResource(
  taskId: number,
  resourceId: number,
  deps: ConfirmLinkResourceDeps,
): Promise<ConfirmLinkResourceRow | null> {
  return (await taggedRows(taskId, deps)).find((r) => r.id === resourceId) ?? null;
}

/**
 * Every resource of the task with its public flag, for the issuer UI.
 *
 * @param taskId - Task id / 対象タスク
 * @param deps - Tag store and resource reader / 依存
 * @returns id, title and flag per resource / 資料ごとの公開可フラグ
 */
export async function listIssuerResources(
  taskId: number,
  deps: ConfirmLinkResourceDeps,
): Promise<Array<{ id: number; title: string; externalPublic: boolean }>> {
  const [rows, tags] = await Promise.all([
    deps.readResources(taskId),
    deps.store.getResourceTags(),
  ]);
  return rows
    .filter((r) => r.taskId === taskId)
    .map((r) => ({ id: r.id, title: r.title, externalPublic: isTagged(tags, r.id) }));
}
