/**
 * workflow-case-context テスト (R9 CBR)
 *
 * 純粋関数（類似ケースのランク付け・プロンプト節のレンダリング）と、
 * buildCaseContext のフェイルセーフ（候補なし/成果物なし→空文字）を検証。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTaskFindUnique = mock(() => Promise.resolve<{ themeId: number | null } | null>(null));
const mockTaskFindMany = mock(() => Promise.resolve([] as Array<{ id: number; title: string }>));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { task: { findUnique: mockTaskFindUnique, findMany: mockTaskFindMany } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const mockResolveWorkflowDir = mock((id: number) => Promise.resolve({ dir: `/wf/${id}` }));
const mockReadWorkflowFile = mock((_dir: string, _ft: string) =>
  Promise.resolve<string | null>(null),
);
mock.module('../../services/workflow/workflow-file-utils', () => ({
  resolveWorkflowDir: mockResolveWorkflowDir,
  readWorkflowFile: mockReadWorkflowFile,
}));

const { rankSolvedCases, renderCaseSection, buildCaseContext } =
  await import('../../services/workflow/workflow-case-context');

beforeEach(() => {
  mockTaskFindUnique.mockReset().mockResolvedValue({ themeId: 1 });
  mockTaskFindMany.mockReset().mockResolvedValue([]);
  mockResolveWorkflowDir
    .mockReset()
    .mockImplementation((id: number) => Promise.resolve({ dir: `/wf/${id}` }));
  mockReadWorkflowFile.mockReset().mockResolvedValue(null);
});

describe('rankSolvedCases', () => {
  test('類似度順に並び、閾値未満は除外される', () => {
    const ranked = rankSolvedCases('サブタスクの説明を表示できるようにする', [
      { id: 1, title: 'サブタスクの説明の表示改善' },
      { id: 2, title: '全く関係ないPDF出力機能' },
      { id: 3, title: 'サブタスクの説明を編集できるようにする' },
    ]);
    expect(ranked.map((r) => r.id)).not.toContain(2);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked[0]!.similarity).toBeGreaterThanOrEqual(ranked[1]!.similarity);
  });

  test('候補ゼロなら空配列', () => {
    expect(rankSolvedCases('x', [])).toEqual([]);
  });
});

describe('renderCaseSection', () => {
  test('ケースなしは空文字', () => {
    expect(renderCaseSection([], 'ja')).toBe('');
  });

  test('タイトル・plan抜粋・verify要点・適応指示を含む', () => {
    const out = renderCaseSection(
      [
        {
          taskId: 42,
          title: '類似タスク',
          similarity: 0.5,
          plan: '# 計画\n- [ ] step1',
          verifySummary: '# 検証レポート\n✅ 検証成功',
        },
      ],
      'ja',
    );
    expect(out).toContain('#42');
    expect(out).toContain('類似タスク');
    expect(out).toContain('step1');
    expect(out).toContain('検証成功');
    expect(out).toContain('コピペせず');
  });

  test('長い plan は切り詰められる', () => {
    const out = renderCaseSection(
      [
        {
          taskId: 1,
          title: 't',
          similarity: 0.3,
          plan: 'x'.repeat(10_000),
          verifySummary: null,
        },
      ],
      'en',
    );
    expect(out.length).toBeLessThan(5_000);
  });
});

describe('buildCaseContext — フェイルセーフ', () => {
  test('解決済み候補がなければ空文字', async () => {
    expect(await buildCaseContext(1, { title: 't', description: null })).toBe('');
  });

  test('plan.md が消えている候補（cleanup済み）はスキップして空文字', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 2, title: 'ほぼ同じタイトルのタスクA' }]);
    mockReadWorkflowFile.mockResolvedValue(null); // plan missing
    expect(
      await buildCaseContext(1, { title: 'ほぼ同じタイトルのタスクB', description: null }),
    ).toBe('');
  });

  test('plan がある最近傍ケースを節としてレンダリングする', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 2, title: 'ほぼ同じタイトルのタスクA' }]);
    mockReadWorkflowFile.mockImplementation((_dir: string, ft: string) =>
      Promise.resolve(ft === 'plan' ? '# 計画\n- [ ] やる' : null),
    );
    const out = await buildCaseContext(1, {
      title: 'ほぼ同じタイトルのタスクB',
      description: null,
    });
    expect(out).toContain('#2');
    expect(out).toContain('やる');
  });

  test('DBエラーでも空文字（例外を伝播しない）', async () => {
    mockTaskFindMany.mockRejectedValue(new Error('db down'));
    expect(await buildCaseContext(1, { title: 't', description: null })).toBe('');
  });
});
