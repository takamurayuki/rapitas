/**
 * project-bootstrap-task.test
 *
 * 文書だけのプロジェクトに環境構築タスクを先行させる判定と、その内容を固定する。
 *
 * 実測の背景: 既存の環境構築タスク2件は結果が正反対だった。TempoRaid の 1153 は
 * 「設計書に従い、指定の技術スタックで環境構築を行なう」で完了、ContextFlow の 1152 は
 * 「要件定義書、設計書に従って実装する。」の1行だけで、2026-10-08 に質問を出して
 * draft に戻り以後 blocked のまま。差は記述の具体性だったので、設計書の技術スタックを
 * タスクに引き写すことをテストで固定する。
 */
import { describe, expect, test } from 'bun:test';
import {
  needsEnvironmentBootstrap,
  toBootstrapTaskPayload,
  stackLines,
  BOOTSTRAP_TASK_PREFIX,
  RUNTIME_CONFIG_FILE,
} from './project-bootstrap-task';

describe('needsEnvironmentBootstrap', () => {
  test('要件定義書があり manifest が無ければ環境構築が必要', () => {
    expect(needsEnvironmentBootstrap({ hasRequirements: true, hasManifest: false })).toBe(true);
  });

  test('manifest があれば不要（構築済み）', () => {
    expect(needsEnvironmentBootstrap({ hasRequirements: true, hasManifest: true })).toBe(false);
  });

  test('要件定義書が無ければ対象外（そもそも起票する材料がない）', () => {
    expect(needsEnvironmentBootstrap({ hasRequirements: false, hasManifest: false })).toBe(false);
  });
});

describe('stackLines', () => {
  const design = `# アーキテクチャ概要

クライアントとサーバー。

# 技術スタック

| 区分 | 技術 | バージョン |
| --- | --- | --- |
| FW | Next.js | 16 |
| DB | PostgreSQL | 16 |

# API設計

- POST /api/x
`;

  test('設計書の技術スタックセクションを取り出す', () => {
    const lines = stackLines(design);
    expect(lines.some((l) => l.includes('Next.js'))).toBe(true);
    expect(lines.some((l) => l.includes('PostgreSQL'))).toBe(true);
    // 次のセクションは含めない
    expect(lines.some((l) => l.includes('/api/x'))).toBe(false);
  });

  test('設計書が無い・セクションが無いときは空', () => {
    expect(stackLines(null)).toEqual([]);
    expect(stackLines('# 概要\n\nなにか\n')).toEqual([]);
  });

  test('英語見出しでも拾う', () => {
    expect(stackLines('# Tech Stack\n\n- Vite\n').some((l) => l.includes('Vite'))).toBe(true);
  });
});

describe('toBootstrapTaskPayload', () => {
  const design = '# 技術スタック\n\n| FW | Next.js | 16 |\n';

  test('タイトルに接頭辞とプロジェクト名が入る（タイトル一致で冪等にするため）', () => {
    const p = toBootstrapTaskPayload({ themeId: 34, projectName: 'ContextFlow', design });
    expect(p.title.startsWith(BOOTSTRAP_TASK_PREFIX)).toBe(true);
    expect(p.title).toContain('ContextFlow');
    expect(p.themeId).toBe(34);
  });

  test('設計書の技術スタックを description に引き写す（1152 が止まった原因の除去）', () => {
    const p = toBootstrapTaskPayload({ themeId: 34, projectName: 'X', design });
    expect(p.description).toContain('Next.js');
  });

  test('技術スタックが無い設計書でも、指示を欠かさず着手可能にする', () => {
    const p = toBootstrapTaskPayload({
      themeId: 34,
      projectName: 'X',
      design: '# 概要\n\nなにか\n',
    });
    expect(p.description).toContain('技術スタックのセクションがありません');
    expect(p.description).not.toContain('undefined');
  });

  test('プレビュー設定の登録が受入基準に必ず入る（runtime-smoke を有効化する唯一の手段）', () => {
    const p = toBootstrapTaskPayload({ themeId: 34, projectName: 'X', design });
    const mentions = p.acceptanceCriteria.filter((c) => c.includes(RUNTIME_CONFIG_FILE));
    expect(mentions.length).toBeGreaterThanOrEqual(2);
    expect(p.goals.some((g) => g.includes(RUNTIME_CONFIG_FILE))).toBe(true);
  });

  test('受入基準は exit code か差分で判定できる形になっている', () => {
    const p = toBootstrapTaskPayload({ themeId: 34, projectName: 'X', design });
    expect(p.acceptanceCriteria.length).toBeGreaterThanOrEqual(4);
    for (const c of p.acceptanceCriteria) {
      expect(c).toMatch(/exit 0|差分に含まれている|差分に含まれ|HTTP 200/);
    }
  });

  test('機能実装をしないことが制約に入る（環境構築タスクが機能を作り始めないため）', () => {
    const p = toBootstrapTaskPayload({ themeId: 34, projectName: 'X', design });
    expect(p.constraints.some((c) => c.includes('機能の実装はしない'))).toBe(true);
  });
});
