/**
 * DiagramTemplates
 *
 * The starting points offered above the Mermaid editor.
 *
 * Kept out of the component and exported so every one of them can be put
 * through the real parser in a test. A template that does not parse is worse
 * than no template: the live preview re-renders while you type, so a broken
 * starting point paints "Syntax error in text" the instant it is inserted —
 * which is the wall of errors this editor was just fixed for.
 *
 * Ordered by what the writer is trying to do rather than by Mermaid's own
 * taxonomy: structure, then flow, then comparison, then planning, then
 * analysis, then data modelling. With fourteen chips in one scrolling row,
 * that grouping is the only thing making it navigable.
 *
 * Every source here was confirmed to parse under mermaid 11.16.0. Two
 * candidates were left out deliberately: `sankey-beta`, whose CSV lexer
 * rejects Japanese node names (quoted or not — measured), and
 * `architecture-beta`, which has no use in a note.
 */

/** One starting point: a label key and the source it inserts. */
export interface DiagramTemplate {
  labelKey: string;
  source: string;
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  // ── structure ──────────────────────────────────────────────────────────
  {
    labelKey: 'flowchart',
    source: [
      'graph TD',
      '    A[開始] --> B{条件分岐}',
      '    B -- はい --> C[処理]',
      '    B -- いいえ --> D[スキップ]',
      '    C --> E[終了]',
      '    D --> E',
    ].join('\n'),
  },
  {
    labelKey: 'mindmap',
    source: [
      'mindmap',
      '  root((考えたいこと))',
      '    判断軸',
      '      譲れない条件',
      '      妥協できる条件',
      '    材料',
      '      いま持っているもの',
      '      足りないもの',
      '    やること',
      '      最初の一歩',
    ].join('\n'),
  },
  // ── flow ───────────────────────────────────────────────────────────────
  {
    labelKey: 'sequence',
    source: [
      'sequenceDiagram',
      '    participant ユーザー',
      '    participant システム',
      '    ユーザー->>システム: リクエスト',
      '    システム-->>ユーザー: レスポンス',
    ].join('\n'),
  },
  {
    labelKey: 'state',
    source: [
      'stateDiagram-v2',
      '    [*] --> 待機',
      '    待機 --> 処理中 : 開始',
      '    処理中 --> 完了 : 成功',
      '    処理中 --> エラー : 失敗',
      '    完了 --> [*]',
      '    エラー --> 待機 : リセット',
    ].join('\n'),
  },
  {
    labelKey: 'journey',
    source: [
      'journey',
      '    title 体験の起伏',
      '    section 入口',
      '      気づく: 3: 本人',
      '      調べる: 4: 本人',
      '    section 途中',
      '      待たされる: 1: 本人',
      '      進む: 4: 本人',
    ].join('\n'),
  },
  // ── comparison ─────────────────────────────────────────────────────────
  {
    labelKey: 'quadrant',
    source: [
      'quadrantChart',
      '    title 候補の比較',
      '    x-axis 重要でない --> 重要',
      '    y-axis 手間が小さい --> 手間が大きい',
      '    quadrant-1 腰を据えてやる',
      '    quadrant-2 今すぐやる',
      '    quadrant-3 やらない',
      '    quadrant-4 空いた時間に',
      '    候補A: [0.8, 0.7]',
      '    候補B: [0.3, 0.2]',
    ].join('\n'),
  },
  {
    labelKey: 'radar',
    source: [
      'radar-beta',
      '  title 候補を軸ごとに比べる',
      '  axis a["条件1"], b["条件2"], c["条件3"], d["条件4"]',
      '  curve x["候補A"]{4, 5, 3, 4}',
      '  curve y["候補B"]{5, 3, 4, 2}',
      '  max 5',
      '  min 0',
    ].join('\n'),
  },
  {
    labelKey: 'pie',
    source: ['pie title 内訳', '    "A" : 50', '    "B" : 30', '    "C" : 20'].join('\n'),
  },
  // ── planning ───────────────────────────────────────────────────────────
  {
    labelKey: 'gantt',
    source: [
      'gantt',
      '    title プロジェクト計画',
      '    dateFormat YYYY-MM-DD',
      '    section 設計',
      '    要件定義 :a1, 2024-01-01, 7d',
      '    基本設計  :after a1  , 5d',
      '    section 開発',
      '    実装      :2024-01-14, 14d',
    ].join('\n'),
  },
  {
    labelKey: 'timeline',
    source: [
      'timeline',
      '    title 期限までの流れ',
      '    section 1ヶ月目',
      '      準備 : 材料をそろえる : 下調べ',
      '    section 2ヶ月目',
      '      実行 : 動かす',
      '    section 3ヶ月目',
      '      仕上げ : 決める',
    ].join('\n'),
  },
  {
    labelKey: 'kanban',
    source: [
      'kanban',
      '  未着手',
      '    [最初の一歩]',
      '  進行中',
      '    [いま手を動かしているもの]',
      '  完了',
      '    [終わったもの]',
    ].join('\n'),
  },
  // ── analysis ───────────────────────────────────────────────────────────
  {
    labelKey: 'ishikawa',
    source: [
      'ishikawa',
      '    title うまくいかない原因',
      '    人',
      '      慣れていない',
      '    方法',
      '      手順が決まっていない',
      '    材料',
      '      情報が足りない',
      '    環境',
      '      時間が取れない',
    ].join('\n'),
  },
  // ── data modelling ─────────────────────────────────────────────────────
  {
    labelKey: 'er',
    source: [
      'erDiagram',
      '    USER ||--o{ ORDER : places',
      '    ORDER ||--|{ LINE_ITEM : contains',
      '    PRODUCT ||--o{ LINE_ITEM : "ordered in"',
    ].join('\n'),
  },
  {
    labelKey: 'class',
    source: [
      'classDiagram',
      '    class Animal{',
      '        +String name',
      '        +speak() String',
      '    }',
      '    class Dog {',
      '        +fetch()',
      '    }',
      '    Animal <|-- Dog',
    ].join('\n'),
  },
];
