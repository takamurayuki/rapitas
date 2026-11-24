/**
 * confirm-link-store.test
 *
 * One active link per task, one-shot reservation, and the resource tag file
 * (acceptance criterion 3 of task 1430).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConfirmLinkStore, type ConfirmLinkRecord } from '../confirm-link-store';

const NOW = 1_800_000_000_000;
let dir: string;

function record(linkId: string, overrides: Partial<ConfirmLinkRecord> = {}): ConfirmLinkRecord {
  return {
    linkId,
    taskId: 1,
    pauseTransitionId: 10,
    questionId: 'Q1',
    optionKeys: ['A', 'B'],
    message: '',
    issuedAt: NOW,
    expiresAt: NOW + 86_400_000,
    state: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('confirm-link store', () => {
  test('re-issuing for the same task revokes the old link', async () => {
    const store = createConfirmLinkStore({ dir });
    await store.issue(record('old'), NOW);
    await store.issue(record('new'), NOW);

    expect((await store.get('old'))?.state).toBe('revoked');
    expect((await store.get('old'))?.revokedReason).toBe('reissued');
    expect((await store.get('new'))?.state).toBe('active');
  });

  test('two concurrent issues leave exactly one active link', async () => {
    const store = createConfirmLinkStore({ dir });
    await Promise.all([store.issue(record('a'), NOW), store.issue(record('b'), NOW)]);
    const active = (await store.list(1)).filter((l) => l.state === 'active');
    expect(active).toHaveLength(1);
  });

  test('a link can be reserved once; the second reserve fails', async () => {
    const store = createConfirmLinkStore({ dir });
    await store.issue(record('one'), NOW);
    expect(await store.reserve('one', NOW)).toBe(true);
    expect(await store.reserve('one', NOW)).toBe(false);
    expect((await store.get('one'))?.state).toBe('answering');
  });

  test('of two concurrent reserves only one succeeds, even with a delay inside the lock', async () => {
    const store = createConfirmLinkStore({
      dir,
      beforeWrite: () => new Promise((r) => setTimeout(r, 20)),
    });
    await store.issue(record('race'), NOW);
    const results = await Promise.all([store.reserve('race', NOW), store.reserve('race', NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('an expired link cannot be reserved', async () => {
    const store = createConfirmLinkStore({ dir });
    await store.issue(record('late'), NOW);
    expect(await store.reserve('late', NOW + 86_400_000)).toBe(false);
  });

  test('revoke never overwrites an answered link', async () => {
    const store = createConfirmLinkStore({ dir });
    await store.issue(record('done'), NOW);
    await store.reserve('done', NOW);
    await store.markAnswered('done', NOW + 5);
    await store.revoke('done', 'question_resolved_internally');
    const got = await store.get('done');
    expect(got?.state).toBe('answered');
    expect(got?.answeredAt).toBe(NOW + 5);
  });

  test('release returns an answering link to active', async () => {
    const store = createConfirmLinkStore({ dir });
    await store.issue(record('retry'), NOW);
    await store.reserve('retry', NOW);
    await store.release('retry');
    expect((await store.get('retry'))?.state).toBe('active');
  });

  test('records expired for more than 7 days are purged on issue', async () => {
    const store = createConfirmLinkStore({ dir });
    await store.issue(record('ancient', { taskId: 2, expiresAt: NOW - 8 * 86_400_000 }), NOW);
    await store.issue(record('fresh'), NOW);
    expect(await store.get('ancient')).toBeNull();
  });

  test('resource tags are set and cleared', async () => {
    const store = createConfirmLinkStore({ dir });
    expect(await store.getResourceTags()).toEqual({});
    await store.setResourceTag(5, true);
    expect(await store.getResourceTags()).toEqual({ '5': ['external_public'] });
    await store.setResourceTag(5, false);
    expect(await store.getResourceTags()).toEqual({});
  });
});
