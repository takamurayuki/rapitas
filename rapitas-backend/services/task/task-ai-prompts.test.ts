/**
 * task-ai-prompts ユニットテスト
 *
 * 純粋関数のみで構成されるモジュールのため mock.module は不要。
 * buildTaskSummary / buildPatternSummary / buildPreferenceSummary の
 * 分岐（空入力・null項目・複数件・文字列切り詰め）を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  AI_SUGGESTION_SYSTEM_PROMPT,
  buildTaskSummary,
  buildPatternSummary,
  buildPreferenceSummary,
} from './task-ai-prompts';

describe('AI_SUGGESTION_SYSTEM_PROMPT', () => {
  test('空でない文字列であり、期待するJSONキーへの言及を含むこと', () => {
    expect(typeof AI_SUGGESTION_SYSTEM_PROMPT).toBe('string');
    expect(AI_SUGGESTION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(AI_SUGGESTION_SYSTEM_PROMPT).toContain('"suggestions"');
    expect(AI_SUGGESTION_SYSTEM_PROMPT).toContain('"estimatedHours"');
  });
});

describe('buildTaskSummary', () => {
  test('空配列の場合 → プレースホルダー文字列を返すこと', () => {
    expect(buildTaskSummary([])).toBe('（まだ完了タスクがありません）');
  });

  test('estimatedHours と actualHours が両方ある場合 → 見積精度を百分率で算出すること', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクA',
        description: null,
        priority: 'high',
        estimatedHours: 4,
        actualHours: 5,
        taskLabels: [],
      },
    ]);
    expect(result).toContain('見積精度: 125%');
    expect(result).toContain('優先度: high');
    expect(result).toContain('見積: 4h');
    expect(result).toContain('実績: 5h');
  });

  test('estimatedHours が null の場合 → 「未設定」表示になり精度は算出しないこと', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクB',
        description: null,
        priority: 'low',
        estimatedHours: null,
        actualHours: 3,
        taskLabels: [],
      },
    ]);
    expect(result).toContain('見積: 未設定h');
    expect(result).not.toContain('見積精度');
  });

  test('actualHours が null の場合 → 「未記録」表示になり精度は算出しないこと', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクC',
        description: null,
        priority: 'medium',
        estimatedHours: 2,
        actualHours: null,
        taskLabels: [],
      },
    ]);
    expect(result).toContain('実績: 未記録h');
    expect(result).not.toContain('見積精度');
  });

  test('taskLabels が未指定の場合 → ラベル表示は「なし」になること', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクD',
        description: null,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: undefined,
      },
    ]);
    expect(result).toContain('ラベル: なし');
  });

  test('taskLabels が空配列の場合 → ラベル表示は「なし」になること', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクE',
        description: null,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: [],
      },
    ]);
    expect(result).toContain('ラベル: なし');
  });

  test('taskLabels に複数要素がある場合 → カンマ区切りで結合されること', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクF',
        description: null,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: [{ label: { name: 'bug' } }, { label: { name: 'urgent' } }],
      },
    ]);
    expect(result).toContain('ラベル: bug, urgent');
  });

  test('description が80文字を超える場合 → 80文字に切り詰められること', () => {
    const longDesc = 'あ'.repeat(100);
    const result = buildTaskSummary([
      {
        title: 'タスクG',
        description: longDesc,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: [],
      },
    ]);
    expect(result).toContain(`- ${'あ'.repeat(80)}`);
    expect(result).not.toContain('あ'.repeat(81));
  });

  test('description が null の場合 → 説明サフィックスが付与されないこと', () => {
    const result = buildTaskSummary([
      {
        title: 'タスクH',
        description: null,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: [],
      },
    ]);
    expect(result).not.toContain(' - ');
  });

  test('複数タスクの場合 → 1始まりの連番付きで改行結合されること', () => {
    const result = buildTaskSummary([
      {
        title: '1件目',
        description: null,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: [],
      },
      {
        title: '2件目',
        description: null,
        priority: 'low',
        estimatedHours: 1,
        actualHours: 1,
        taskLabels: [],
      },
    ]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('1. "1件目"');
    expect(lines[1]).toContain('2. "2件目"');
  });
});

describe('buildPatternSummary', () => {
  test('空配列の場合 → 空文字列を返すこと', () => {
    expect(buildPatternSummary([])).toBe('');
  });

  test('averageTimeToStart / averageTimeToComplete が両方ある場合 → 丸めて表示すること', () => {
    const result = buildPatternSummary([
      {
        taskTitle: '週次レポート作成',
        frequency: 4,
        priority: 'medium',
        averageTimeToStart: 2.6,
        averageTimeToComplete: 3.4,
      },
    ]);
    expect(result).toContain('【頻繁に実行されるタスクパターン】');
    expect(result).toContain('"週次レポート作成"');
    expect(result).toContain('頻度: 4回');
    expect(result).toContain('平均開始時間: 3時間後');
    expect(result).toContain('平均完了時間: 3時間');
  });

  test('averageTimeToStart が null の場合 → その項目が空文字列になること', () => {
    const result = buildPatternSummary([
      {
        taskTitle: 'パターンA',
        frequency: 1,
        priority: 'low',
        averageTimeToStart: null,
        averageTimeToComplete: 5,
      },
    ]);
    expect(result).not.toContain('平均開始時間');
    expect(result).toContain('平均完了時間: 5時間');
  });

  test('averageTimeToComplete が null の場合 → その項目が空文字列になること', () => {
    const result = buildPatternSummary([
      {
        taskTitle: 'パターンB',
        frequency: 1,
        priority: 'low',
        averageTimeToStart: 5,
        averageTimeToComplete: null,
      },
    ]);
    expect(result).toContain('平均開始時間: 5時間後');
    expect(result).not.toContain('平均完了時間');
  });

  test('複数パターンの場合 → 連番付きで改行結合されること', () => {
    const result = buildPatternSummary([
      {
        taskTitle: 'A',
        frequency: 1,
        priority: 'low',
        averageTimeToStart: null,
        averageTimeToComplete: null,
      },
      {
        taskTitle: 'B',
        frequency: 2,
        priority: 'high',
        averageTimeToStart: null,
        averageTimeToComplete: null,
      },
    ]);
    expect(result).toContain('1. "A"');
    expect(result).toContain('2. "B"');
  });
});

describe('buildPreferenceSummary', () => {
  test('null の場合 → 空文字列を返すこと', () => {
    expect(buildPreferenceSummary(null)).toBe('');
  });

  test('全項目がnullの場合 → 「不明」/「なし」のプレースホルダーになること', () => {
    const result = buildPreferenceSummary({
      preferredTimeOfDay: null,
      mostUsedLabels: null,
      taskPriorities: null,
      averageCompletionTime: null,
    });
    expect(result).toContain('好みの作業時間帯: 不明');
    expect(result).toContain('平均完了時間: 不明');
    expect(result).toContain('よく使うラベル: なし');
    expect(result).toContain('優先度の傾向: 不明');
  });

  test('全項目が設定済みの場合 → JSONをパースして上位3件のラベルのみ表示すること', () => {
    const result = buildPreferenceSummary({
      preferredTimeOfDay: '午前',
      mostUsedLabels: JSON.stringify([
        { labelId: 'l1' },
        { labelId: 'l2' },
        { labelId: 'l3' },
        { labelId: 'l4' },
      ]),
      taskPriorities: JSON.stringify({ high: 3, low: 1 }),
      averageCompletionTime: 2.6,
    });
    expect(result).toContain('好みの作業時間帯: 午前');
    expect(result).toContain('平均完了時間: 3時間');
    expect(result).toContain('よく使うラベル: l1, l2, l3');
    expect(result).not.toContain('l4');
    expect(result).toContain('優先度の傾向: high: 3, low: 1');
  });

  test('mostUsedLabels/taskPriorities が空配列・空オブジェクトの場合 → 「なし」/「不明」になること', () => {
    const result = buildPreferenceSummary({
      preferredTimeOfDay: '午後',
      mostUsedLabels: JSON.stringify([]),
      taskPriorities: JSON.stringify({}),
      averageCompletionTime: 1,
    });
    expect(result).toContain('よく使うラベル: なし');
    expect(result).toContain('優先度の傾向: 不明');
  });
});
