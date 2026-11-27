/**
 * plan-size-policy テスト
 *
 * 計画の大きさの計測（節限定・境界値・親ディレクトリ非計上）と、
 * ja/en の切り出し指示文が定数と一致することを検証する。
 */
import { describe, expect, test } from 'bun:test';
import {
  PLAN_MAX_CHECKLIST_ITEMS,
  PLAN_MAX_CHANGED_FILES,
  PLAN_SIZE_GUIDANCE,
  isPlanOversized,
  measurePlanSize,
} from './plan-size-policy';

function planWith(items: number, files: number): string {
  const checklist = Array.from({ length: items }, (_, i) => `- [ ] 項目 ${i}`).join('\n');
  const fileRows = Array.from({ length: files }, (_, i) => `- \`pkg/dir${i}/file${i}.ts\``).join(
    '\n',
  );
  return `# 計画\n\n## 変更予定ファイル\n\n${fileRows}\n\n## 実装チェックリスト\n\n${checklist}\n\n## リスク\n\n- [ ] 節外の項目 \`other/outside.ts\`\n`;
}

describe('定数', () => {
  test('目安は 10 項目・15 ファイル', () => {
    expect(PLAN_MAX_CHECKLIST_ITEMS).toBe(10);
    expect(PLAN_MAX_CHANGED_FILES).toBe(15);
  });
});

describe('measurePlanSize', () => {
  test('節内だけを数え、親ディレクトリと節外は数えない', () => {
    const size = measurePlanSize(planWith(3, 4));
    expect(size).toEqual({ checklistItems: 3, changedFiles: 4 });
  });

  test('空文字列は 0 件', () => {
    expect(measurePlanSize('')).toEqual({ checklistItems: 0, changedFiles: 0 });
  });

  test('完了済み・ネストした項目も数え、サブ見出しは節に含める', () => {
    const md =
      '## 実装チェックリスト\n### Step A\n- [x] a\n  - [ ] b\n### Step B\n- [X] c\n## 次\n- [ ] d';
    expect(measurePlanSize(md).checklistItems).toBe(3);
  });

  test('英語見出しも認識する', () => {
    const md = '## Implementation checklist\n- [ ] a\n## Files to change\n- `a/b.ts`';
    expect(measurePlanSize(md)).toEqual({ checklistItems: 1, changedFiles: 1 });
  });
});

describe('isPlanOversized（境界値）', () => {
  test('10 項目・15 ファイルちょうどは超過しない', () => {
    expect(isPlanOversized(measurePlanSize(planWith(10, 15)))).toBe(false);
  });
  test('11 項目は超過', () => {
    expect(isPlanOversized(measurePlanSize(planWith(11, 1)))).toBe(true);
  });
  test('16 ファイルは超過', () => {
    expect(isPlanOversized(measurePlanSize(planWith(1, 16)))).toBe(true);
  });
});

describe('PLAN_SIZE_GUIDANCE', () => {
  for (const lang of ['ja', 'en'] as const) {
    test(`${lang}: 目安値と親子関係なしの固有文言を含む`, () => {
      const text = PLAN_SIZE_GUIDANCE[lang];
      expect(text).toContain(String(PLAN_MAX_CHECKLIST_ITEMS));
      expect(text).toContain(String(PLAN_MAX_CHANGED_FILES));
      expect(text).toContain('themeId');
      expect(text).toContain(
        lang === 'ja' ? 'parentId を付けない通常のタスク' : 'ordinary task without parentId',
      );
    });
  }
});
