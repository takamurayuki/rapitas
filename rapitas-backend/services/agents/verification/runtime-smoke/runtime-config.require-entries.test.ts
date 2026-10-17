/**
 * runtime-config.require-entries.test
 *
 * Covers `taskRequiresFeatureEntries`, which decides whether the reachability
 * check demands a registered entry.
 *
 * The obligation and its enforcement must read from the SAME place. Deciding
 * by task TITLE instead cost a real task: ContextFlow's `[UI] ログイン` hosts
 * no feature — no 画面導線 line names it — so its task deliberately asked for
 * no registration, and a title-based gate failed it anyway for not doing what
 * it had been told not to do (#1031).
 *
 * `prisma` is mocked in its own file because `mock.module` is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTaskFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { task: { findUnique: mockTaskFindUnique } },
}));

const { taskRequiresFeatureEntries } = await import('./runtime-config');

/** A criterion in the shape toScreenTaskPayload emits for a hosting screen. */
const REGISTERING = JSON.stringify([
  'Given アプリを起動した状態 When 操作する Then 画面が表示される',
  'Given 差分の rapitas.runtime.json When featureEntries を読む Then F-01 / F-02 のそれぞれに、この画面のファイルを指す entry がある',
]);

/** The criteria of a screen that hosts nothing — no registration asked for. */
const NOT_REGISTERING = JSON.stringify([
  'Given アプリを起動した状態 When 操作する Then 画面が表示される',
  'Given 差分 When テストを確認する Then 描画と遷移を検証するテストが含まれている',
]);

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
});

describe('taskRequiresFeatureEntries', () => {
  test('is true when the task asked for the registration', async () => {
    mockTaskFindUnique.mockResolvedValue({
      title: '[UI] ソース管理',
      acceptanceCriteria: REGISTERING,
    });
    expect(await taskRequiresFeatureEntries(7)).toBe(true);
  });

  test('is false for a screen task that hosts no feature', async () => {
    // The whole point of #1031: this task was told not to register anything.
    mockTaskFindUnique.mockResolvedValue({
      title: '[UI] ログイン',
      acceptanceCriteria: NOT_REGISTERING,
    });
    expect(await taskRequiresFeatureEntries(7)).toBe(false);
  });

  test.each([
    ['a feature task', '[F-01] 音声読込と解析'],
    ['the environment task', '[ENV] 環境構築'],
    ['the spec gate task', '[SPEC] 要件定義の不足を埋める'],
    ['the documentation task', '[DOC] 追随'],
  ])('is false for %s even if its criteria mention the field', async (_label, title) => {
    // Only a screen task can be asked to register one; nothing else should be
    // failed for it, whatever its prose happens to contain.
    mockTaskFindUnique.mockResolvedValue({ title, acceptanceCriteria: REGISTERING });
    expect(await taskRequiresFeatureEntries(7)).toBe(false);
  });

  test('tolerates leading whitespace in the title', async () => {
    mockTaskFindUnique.mockResolvedValue({
      title: '  [UI] ソース管理',
      acceptanceCriteria: REGISTERING,
    });
    expect(await taskRequiresFeatureEntries(7)).toBe(true);
  });

  test('is false when the criteria are absent or unparseable', async () => {
    for (const acceptanceCriteria of [null, '', 'not json', '{}']) {
      mockTaskFindUnique.mockResolvedValue({ title: '[UI] ログイン', acceptanceCriteria });
      expect(await taskRequiresFeatureEntries(7)).toBe(false);
    }
  });

  test('is false without a task id, so an adhoc run demands nothing', async () => {
    expect(await taskRequiresFeatureEntries(undefined)).toBe(false);
    expect(await taskRequiresFeatureEntries(null)).toBe(false);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });

  test('is false when the task is gone', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    expect(await taskRequiresFeatureEntries(7)).toBe(false);
  });

  test('is false when the lookup throws, so a DB blip never invents a failure', async () => {
    mockTaskFindUnique.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await taskRequiresFeatureEntries(7)).toBe(false);
  });
});
