/**
 * gen-boundary-guide.test
 *
 * gen-boundary-guide.ts の全エクスポート関数をカバーするユニット+統合テスト。
 * bun test --isolate 前提で実行される（SSOT が純定数ファイルのため mock.module 不要）。
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  extractJsDoc,
  renderCasesTable,
  generateGuideContent,
  parseFilesArg,
  isRelevantChange,
  checkDrift,
} from './gen-boundary-guide';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const TMP_GUIDE = join(SCRIPTS_DIR, '.tmp-boundary-guide-test.md');

afterAll(() => {
  if (existsSync(TMP_GUIDE)) unlinkSync(TMP_GUIDE);
});

// ---------------------------------------------------------------------------
// extractJsDoc
// ---------------------------------------------------------------------------
describe('extractJsDoc', () => {
  test('複数行 JSDoc を先頭説明段落のみ抽出する', () => {
    const source = [
      '/**',
      ' * This is the description.',
      ' *',
      ' * More detail here.',
      ' *',
      ' * @param x - some param',
      ' */',
      'export const MY_CONST = 1;',
    ].join('\n');
    const result = extractJsDoc(source, 'MY_CONST');
    expect(result).toContain('This is the description.');
    expect(result).not.toContain('@param');
  });

  test('単一行 JSDoc を抽出する', () => {
    const source = '/** Short description. */\nexport const SHORT_CONST = 42;';
    const result = extractJsDoc(source, 'SHORT_CONST');
    expect(result).toBe('Short description.');
  });

  test('JSDoc がない場合は空文字を返す', () => {
    const source = 'export const NO_DOC = 0;';
    const result = extractJsDoc(source, 'NO_DOC');
    expect(result).toBe('');
  });

  test('@example 行以降を除外する', () => {
    const source = [
      '/**',
      ' * Summary line.',
      ' *',
      ' * @example',
      ' * ```ts',
      ' * const x = EDGES[0].value;',
      ' * ```',
      ' */',
      'export const EDGES = [];',
    ].join('\n');
    const result = extractJsDoc(source, 'EDGES');
    expect(result).toContain('Summary line.');
    expect(result).not.toContain('@example');
    expect(result).not.toContain('const x');
  });

  test('export type にも対応する', () => {
    const source = '/** Type description. */\nexport type MyType<T> = {};';
    const result = extractJsDoc(source, 'MyType');
    expect(result).toBe('Type description.');
  });

  test('export function にも対応する', () => {
    const source = '/** Func description. */\nexport function myFunc() {}';
    const result = extractJsDoc(source, 'myFunc');
    expect(result).toBe('Func description.');
  });
});

// ---------------------------------------------------------------------------
// renderCasesTable
// ---------------------------------------------------------------------------
describe('renderCasesTable', () => {
  test('空文字列を JSON エスケープで表示する', () => {
    const cases = [{ label: '空文字', value: '' }];
    const result = renderCasesTable(cases);
    expect(result).toContain('`""`');
  });

  test('タブ文字を JSON エスケープで表示する', () => {
    const cases = [{ label: 'タブ', value: '\t' }];
    const result = renderCasesTable(cases);
    expect(result).toContain('`"\\t"`');
  });

  test('改行文字を JSON エスケープで表示する', () => {
    const cases = [{ label: '改行', value: '\n' }];
    const result = renderCasesTable(cases);
    expect(result).toContain('`"\\n"`');
  });

  test('null を JSON エスケープで表示する', () => {
    const cases = [{ label: 'null値', value: null }];
    const result = renderCasesTable(cases);
    expect(result).toContain('`null`');
  });

  test('MAX_SAFE_INTEGER を決定論的な数値として表示する', () => {
    const cases = [{ label: '最大', value: Number.MAX_SAFE_INTEGER }];
    const result = renderCasesTable(cases);
    expect(result).toContain('`9007199254740991`');
  });

  test('note フィールドが存在する場合は表示する', () => {
    const cases = [{ label: 'テスト', value: 0, note: 'DB にレコードなし前提' }];
    const result = renderCasesTable(cases);
    expect(result).toContain('DB にレコードなし前提');
  });

  test('note が省略された場合は空セルになる', () => {
    const cases = [{ label: 'no note', value: 1 }];
    const result = renderCasesTable(cases);
    // note 列のセルが空（スペースなし）であること
    expect(result).toContain('|  |');
  });

  test('ヘッダー行が存在する', () => {
    const result = renderCasesTable([{ label: 'x', value: 0 }]);
    expect(result).toContain('| label | value | note |');
    expect(result).toContain('| --- | --- | --- |');
  });
});

// ---------------------------------------------------------------------------
// parseFilesArg
// ---------------------------------------------------------------------------
describe('parseFilesArg', () => {
  test('--files=a,b 形式をパースする', () => {
    const result = parseFilesArg(['node', 'script.ts', '--check', '--files=a.ts,b.ts']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  test('--files 後置形式をパースする', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files', 'a.ts', 'b.ts']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  test('--files がなければ null を返す', () => {
    const result = parseFilesArg(['node', 'script.ts', '--check']);
    expect(result).toBeNull();
  });

  test('--files= に値がなければ空配列を返す', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files=']);
    expect(result).toEqual([]);
  });

  test('--files の後に別フラグが来た場合は手前のファイルのみ返す', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files', 'a.ts', '--check']);
    expect(result).toEqual(['a.ts']);
  });
});

// ---------------------------------------------------------------------------
// isRelevantChange
// ---------------------------------------------------------------------------
describe('isRelevantChange', () => {
  test('boundary-values.ts を含む場合は true', () => {
    expect(isRelevantChange(['src/foo.ts', 'tests/helpers/boundary-values.ts'])).toBe(true);
  });

  test('boundary-values-guide.md を含む場合は true', () => {
    expect(isRelevantChange(['docs/boundary-values-guide.md'])).toBe(true);
  });

  test('無関係なファイルのみの場合は false', () => {
    expect(isRelevantChange(['src/index.ts', 'package.json'])).toBe(false);
  });

  test('空配列は false', () => {
    expect(isRelevantChange([])).toBe(false);
  });

  test('絶対パスでも endsWith で一致する', () => {
    expect(isRelevantChange(['/home/user/project/tests/helpers/boundary-values.ts'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateGuideContent
// ---------------------------------------------------------------------------
describe('generateGuideContent', () => {
  test('手動編集不可ヘッダーを含む', async () => {
    const content = await generateGuideContent();
    expect(content).toContain('自動生成ファイル');
    expect(content).toContain('手動編集不可');
    expect(content).toContain('bun run gen:boundary-guide');
  });

  test('必須セクションが存在する', async () => {
    const content = await generateGuideContent();
    expect(content).toContain('## 型定義');
    expect(content).toContain('## 配列定数');
    expect(content).toContain('## スカラー定数');
    expect(content).toContain('## ユーティリティ');
  });

  test('STRING_EDGES の値が反映される', async () => {
    const content = await generateGuideContent();
    // STRING_EDGES には空文字列が含まれる — JSON.stringify → ""
    expect(content).toContain('`""`');
    expect(content).toContain('STRING_EDGES');
  });

  test('ID_EDGES の値が反映される', async () => {
    const content = await generateGuideContent();
    // ID_EDGES には 0, -1, 1 が含まれる
    expect(content).toContain('ID_EDGES');
    expect(content).toContain('`0`');
    expect(content).toContain('`-1`');
  });

  test('NONEXISTENT_ID の値が反映される', async () => {
    const content = await generateGuideContent();
    expect(content).toContain('NONEXISTENT_ID');
    expect(content).toContain('`999`');
  });

  test('MAX_SAFE_INTEGER が数値文字列として表示される', async () => {
    const content = await generateGuideContent();
    // NUMERIC_ID_BOUNDARIES に MAX_SAFE_INTEGER が含まれる
    expect(content).toContain('9007199254740991');
  });

  test('BoundaryCase<T> の型定義ブロックを含む', async () => {
    const content = await generateGuideContent();
    expect(content).toContain('BoundaryCase<T>');
    expect(content).toContain('readonly label: string');
    expect(content).toContain('readonly value: T');
  });

  test('toNameTuples がユーティリティ節に含まれる', async () => {
    const content = await generateGuideContent();
    expect(content).toContain('toNameTuples');
  });
});

// ---------------------------------------------------------------------------
// checkDrift (統合テスト)
// ---------------------------------------------------------------------------
describe('checkDrift', () => {
  test('再生成後の実ファイルでドリフトがない', async () => {
    // NOTE: このテストは bun run gen:boundary-guide 実行後にのみ安定して通る。
    //       docs/boundary-values-guide.md が最新状態でコミットされている前提。
    const drifts = await checkDrift();
    expect(drifts).toHaveLength(0);
  });

  test('存在しないパスを渡すと missing を返す', async () => {
    const nonExistentPath = join(SCRIPTS_DIR, '.non-existent-guide-xyz.md');
    const drifts = await checkDrift(nonExistentPath);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].status).toBe('missing');
    expect(drifts[0].file).toBe(nonExistentPath);
  });

  test('内容が異なるファイルを渡すと mismatch を返す', async () => {
    writeFileSync(TMP_GUIDE, '# This is stale content\n', 'utf-8');
    const drifts = await checkDrift(TMP_GUIDE);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].status).toBe('mismatch');
    expect(drifts[0].file).toBe(TMP_GUIDE);
  });

  test('最新コンテンツと一致するファイルを渡すとドリフトなし', async () => {
    const expected = await generateGuideContent();
    writeFileSync(TMP_GUIDE, expected, 'utf-8');
    const drifts = await checkDrift(TMP_GUIDE);
    expect(drifts).toHaveLength(0);
  });
});
