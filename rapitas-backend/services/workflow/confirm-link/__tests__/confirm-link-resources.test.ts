/**
 * confirm-link-resources.test
 *
 * Only resources tagged 「外部公開可」 are listed or fetchable, including by
 * direct id (acceptance criterion 5 of task 1430).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConfirmLinkStore, type ConfirmLinkStore } from '../confirm-link-store';
import {
  getPublicResource,
  listIssuerResources,
  listPublicResources,
  setConfirmLinkResourceVisibility,
  type ConfirmLinkResourceRow,
} from '../confirm-link-resources';

const ROWS: ConfirmLinkResourceRow[] = [
  {
    id: 1,
    taskId: 7,
    title: '公開資料',
    type: 'url',
    url: 'https://example.com/a',
    filePath: null,
    fileName: null,
    mimeType: null,
  },
  {
    id: 2,
    taskId: 7,
    title: '社内限定',
    type: 'file',
    url: null,
    filePath: 'secret.pdf',
    fileName: 'secret.pdf',
    mimeType: 'application/pdf',
  },
  {
    id: 3,
    taskId: 8,
    title: '別タスク',
    type: 'url',
    url: 'https://example.com/c',
    filePath: null,
    fileName: null,
    mimeType: null,
  },
];

let dir: string;
let store: ConfirmLinkStore;
const readResources = async (taskId: number) => ROWS.filter((r) => r.taskId === taskId);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-res-'));
  store = createConfirmLinkStore({ dir });
  await store.setResourceTag(1, true);
  await store.setResourceTag(3, true);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('confirm-link resources', () => {
  test('the list holds only the tagged resource of this task', async () => {
    const list = await listPublicResources(7, { store, readResources });
    expect(list.map((r) => r.id)).toEqual([1]);
    expect(list.map((r) => r.title)).not.toContain('社内限定');
  });

  test('an untagged resource id is not fetchable directly', async () => {
    expect(await getPublicResource(7, 2, { store, readResources })).toBeNull();
  });

  test('a tagged resource of another task is not fetchable through this task', async () => {
    expect(await getPublicResource(7, 3, { store, readResources })).toBeNull();
  });

  test('a tagged resource of this task is fetchable', async () => {
    expect((await getPublicResource(7, 1, { store, readResources }))?.title).toBe('公開資料');
  });

  test('a resource is non-public until it is tagged', async () => {
    await store.setResourceTag(1, false);
    expect(await listPublicResources(7, { store, readResources })).toEqual([]);
  });

  test('the issuer list shows every resource of the task with its flag', async () => {
    expect(await listIssuerResources(7, { store, readResources })).toEqual([
      { id: 1, title: '公開資料', externalPublic: true },
      { id: 2, title: '社内限定', externalPublic: false },
    ]);
  });
  test('a resource the workspace cannot see is refused (404) and no tag is written', async () => {
    const setResourceTag = mock(store.setResourceTag);
    await expect(
      setConfirmLinkResourceVisibility(
        { resourceId: 999, externalPublic: true },
        { store: { ...store, setResourceTag }, readResourceOwner: async () => null },
      ),
    ).rejects.toMatchObject({ status: 404, code: 'resource_not_found' });
    expect(setResourceTag).not.toHaveBeenCalled();
  });

  test('a resource attached to no task is refused (404) and no tag is written', async () => {
    const setResourceTag = mock(store.setResourceTag);
    await expect(
      setConfirmLinkResourceVisibility(
        { resourceId: 2, externalPublic: true },
        {
          store: { ...store, setResourceTag },
          readResourceOwner: async () => ({ id: 2, taskId: null }),
        },
      ),
    ).rejects.toMatchObject({ status: 404, code: 'resource_not_found' });
    expect(setResourceTag).not.toHaveBeenCalled();
  });

  test('an existing task resource is tagged with exactly one write', async () => {
    const setResourceTag = mock(store.setResourceTag);
    const res = await setConfirmLinkResourceVisibility(
      { resourceId: 2, externalPublic: true },
      {
        store: { ...store, setResourceTag },
        readResourceOwner: async () => ({ id: 2, taskId: 7 }),
      },
    );
    expect(res).toEqual({ resourceId: 2, externalPublic: true });
    expect(setResourceTag).toHaveBeenCalledTimes(1);
    expect((await store.getResourceTags())['2']).toEqual(['external_public']);
  });
});
