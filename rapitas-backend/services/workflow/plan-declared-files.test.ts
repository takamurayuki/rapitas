/**
 * plan-declared-files テスト
 *
 * 変更宣言節からのパス抽出の境界（見出し語彙・レベル・終端・トークン形）を固定する。
 */
import { describe, test, expect } from 'bun:test';
import { extractPlanDeclaredFiles, PLAN_FILES_SECTION_HEADINGS } from './plan-declared-files';

const NL = String.fromCharCode(10);
const FENCE = '```';
const BS = String.fromCharCode(92);
const md = (...lines: string[]): string => lines.join(NL);

describe('extractPlanDeclaredFiles 見出し語彙', () => {
  test('5語彙のいずれの見出しでも節として認識する', () => {
    expect(PLAN_FILES_SECTION_HEADINGS).toEqual([
      '変更予定ファイル',
      '変更ファイル',
      '対象ファイル',
      '実装ファイル',
      'ファイル計画',
    ]);
    for (const h of PLAN_FILES_SECTION_HEADINGS) {
      const plan = md(`## ${h}`, '- `services/a.ts`');
      expect(extractPlanDeclaredFiles(plan)).toEqual(['services/a.ts']);
    }
  });

  test('装飾付き見出し（太字・番号・## / ### レベル）も認識する', () => {
    expect(extractPlanDeclaredFiles(md('## **変更予定ファイル**', '- `a/b.ts`'))).toEqual([
      'a/b.ts',
    ]);
    expect(extractPlanDeclaredFiles(md('## 3. 変更予定ファイル', '- `a/b.ts`'))).toEqual([
      'a/b.ts',
    ]);
    expect(extractPlanDeclaredFiles(md('### 変更予定ファイル一覧', '- `a/b.ts`'))).toEqual([
      'a/b.ts',
    ]);
    expect(extractPlanDeclaredFiles(md('# 変更ファイル', '- `a/b.ts`'))).toEqual(['a/b.ts']);
  });

  test('「非対象ファイル」などの非目標見出しは宣言節ではない', () => {
    const plan = md('## 非対象ファイル', '- `prisma/schema/core.prisma`');
    expect(extractPlanDeclaredFiles(plan)).toEqual([]);
    expect(extractPlanDeclaredFiles(md('## 変更しないファイル', '- `a.ts`'))).toEqual([]);
  });
});

describe('extractPlanDeclaredFiles 節の境界', () => {
  test('深い小見出しは節内、同レベル以下の見出しで終端する', () => {
    const plan = md(
      '## 変更予定ファイル',
      '### 新規作成',
      '| # | ファイル | 目的 |',
      '|---|---|---|',
      '| 1 | `services/workflow/new.ts` | 新規 |',
      '### 変更予定',
      '- `services/workflow/old.ts` — 修正',
      '## リスク評価',
      '- `prisma/schema/core.prisma` は触らない',
      '# 別章',
      '- `routes/system/auth.ts`',
    );
    expect(extractPlanDeclaredFiles(plan).sort()).toEqual([
      'services/workflow/new.ts',
      'services/workflow/old.ts',
    ]);
  });

  test('複数の宣言節は和集合を返す', () => {
    const plan = md(
      '## 変更ファイル',
      '- `a/one.ts`',
      '## 依存関係',
      '- `prisma/schema/x.prisma`',
      '## 対象ファイル',
      '- `b/two.ts`',
    );
    expect(extractPlanDeclaredFiles(plan).sort()).toEqual(['a/one.ts', 'b/two.ts']);
  });

  test('節の直前・直後の言及は対象外', () => {
    const plan = md(
      '前置き `prisma/schema/a.prisma`',
      '## 変更予定ファイル',
      '- `x.ts`',
      '## 完了条件',
      '`y.ts`',
    );
    expect(extractPlanDeclaredFiles(plan)).toEqual(['x.ts']);
  });

  test('節内のフェンスブロックは無視する', () => {
    const plan = md('## 変更予定ファイル', FENCE, '`prisma/schema/a.prisma`', FENCE, '- `real.ts`');
    expect(extractPlanDeclaredFiles(plan)).toEqual(['real.ts']);
  });
});

describe('extractPlanDeclaredFiles トークン形', () => {
  test('表形式でも列位置を問わず全バッククォートを走査する', () => {
    const plan = md(
      '## 変更予定ファイル',
      '| # | ファイル | 変更内容 |',
      '| 1 | `rapitas-backend/services/a.ts` | `foo()` を追加 |',
    );
    expect(extractPlanDeclaredFiles(plan)).toEqual(['rapitas-backend/services/a.ts']);
  });

  test('ディレクトリトークンは拾い、:line 除去と \ 正規化を行い重複排除する', () => {
    const plan = md(
      '## 変更予定ファイル',
      '- `prisma/schema/`',
      `- \`services${BS}workflow${BS}x.ts:12\``,
      '- `services/workflow/x.ts`',
    );
    expect(extractPlanDeclaredFiles(plan).sort()).toEqual([
      'prisma/schema/',
      'services/workflow/x.ts',
    ]);
  });

  test('非パストークン・空白入りトークンは捨てる', () => {
    const plan = md(
      '## 変更予定ファイル',
      '- `Task.fooBar` を `true` にする',
      '- `bun test services/a.ts` で確認',
      '- `planScope`',
    );
    expect(extractPlanDeclaredFiles(plan)).toEqual([]);
  });

  test('節なし・空・null は空配列', () => {
    expect(extractPlanDeclaredFiles(md('### 変更', '- `prisma/schema/core.prisma`'))).toEqual([]);
    expect(extractPlanDeclaredFiles('')).toEqual([]);
    expect(extractPlanDeclaredFiles(null)).toEqual([]);
  });
});
