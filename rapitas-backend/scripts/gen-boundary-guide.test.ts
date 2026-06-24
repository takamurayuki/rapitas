/**
 * gen-boundary-guide.test.ts
 *
 * `scripts/gen-boundary-guide.ts` および `tests/helpers/boundary-values.ts` の
 * `BOUNDARY_CONTEXT_MAP` に関するユニットテスト。
 *
 * カバー範囲:
 *   - generateGuideMarkdown: 全定数の表出力 / 決定的出力 / 改行フラグの表記
 *   - checkDrift: missing / mismatch / 一致の各パス
 *   - BOUNDARY_CONTEXT_MAP: 全定数の網羅性 / genUsed:true の 3 定数 / reserved ステータス
 *   - parseFilesArg: --files フラグのパース
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateGuideMarkdown,
  checkDrift,
  parseFilesArg,
  type DriftResult,
} from './gen-boundary-guide';
import {
  BOUNDARY_CONTEXT_MAP,
  STRING_EDGES,
  ID_EDGES,
  NULLABLE_ID_EDGES,
  type BoundaryConstMeta,
} from '../tests/helpers/boundary-values';

// ---------------------------------------------------------------------------
// BOUNDARY_CONTEXT_MAP 不変条件テスト
// ---------------------------------------------------------------------------

describe('BOUNDARY_CONTEXT_MAP 不変条件', () => {
  /** boundary-values.ts で export されている BoundaryCase 定数の名前一覧 */
  const EXPECTED_CONST_NAMES = [
    'STRING_EDGES',
    'ID_EDGES',
    'NUMERIC_ID_BOUNDARIES',
    'BOUNDARY_STRINGS',
    'TIME_BOUNDARIES',
    'NULLABLE_ID_EDGES',
  ] as const;

  test('全 BoundaryCase 定数（6 種）が BOUNDARY_CONTEXT_MAP のキーとして存在すること', () => {
    for (const name of EXPECTED_CONST_NAMES) {
      expect(BOUNDARY_CONTEXT_MAP).toHaveProperty(name);
    }
  });

  test('BOUNDARY_CONTEXT_MAP のエントリ数が 6 であること', () => {
    expect(Object.keys(BOUNDARY_CONTEXT_MAP).length).toBe(6);
  });

  test('各エントリの constName がキーと同値であること', () => {
    for (const [key, meta] of Object.entries(BOUNDARY_CONTEXT_MAP)) {
      expect(meta.constName).toBe(key);
    }
  });

  test('genUsed:true の定数が STRING_EDGES / ID_EDGES / NULLABLE_ID_EDGES の 3 件であること', () => {
    const genUsedKeys = Object.entries(BOUNDARY_CONTEXT_MAP)
      .filter(([, m]) => m.genUsed)
      .map(([k]) => k)
      .sort();
    expect(genUsedKeys).toEqual(['ID_EDGES', 'NULLABLE_ID_EDGES', 'STRING_EDGES']);
  });

  test('TIME_BOUNDARIES が status:"reserved" であること', () => {
    expect(BOUNDARY_CONTEXT_MAP['TIME_BOUNDARIES']?.status).toBe('reserved');
  });

  test('STRING_EDGES が includesNewline:false であること', () => {
    expect(BOUNDARY_CONTEXT_MAP['STRING_EDGES']?.includesNewline).toBe(false);
  });

  test('BOUNDARY_STRINGS が includesNewline:true であること', () => {
    expect(BOUNDARY_CONTEXT_MAP['BOUNDARY_STRINGS']?.includesNewline).toBe(true);
  });

  test('NUMERIC_ID_BOUNDARIES が includesLargeValue:true であること', () => {
    expect(BOUNDARY_CONTEXT_MAP['NUMERIC_ID_BOUNDARIES']?.includesLargeValue).toBe(true);
  });

  test('NULLABLE_ID_EDGES が inputType:"number | null" であること', () => {
    expect(BOUNDARY_CONTEXT_MAP['NULLABLE_ID_EDGES']?.inputType).toBe('number | null');
  });

  test('各エントリの useFor が空でないこと', () => {
    for (const [key, meta] of Object.entries(BOUNDARY_CONTEXT_MAP)) {
      expect(meta.useFor.length, `${key}.useFor が空`).toBeGreaterThan(0);
    }
  });

  test('境界値定数の実体と BOUNDARY_CONTEXT_MAP の inputType が型的に整合していること', () => {
    // 各定数の代表値の型が inputType と一致することを確認
    const firstStringEdge = STRING_EDGES[0];
    expect(typeof firstStringEdge.value).toBe('string');
    expect(BOUNDARY_CONTEXT_MAP['STRING_EDGES']?.inputType).toBe('string');

    const firstIdEdge = ID_EDGES[0];
    expect(typeof firstIdEdge.value).toBe('number');
    expect(BOUNDARY_CONTEXT_MAP['ID_EDGES']?.inputType).toBe('number');

    // NULLABLE_ID_EDGES は null を含む
    const nullableValues = NULLABLE_ID_EDGES.map((c) => c.value);
    expect(nullableValues).toContain(null);
    expect(BOUNDARY_CONTEXT_MAP['NULLABLE_ID_EDGES']?.inputType).toBe('number | null');
  });
});

// ---------------------------------------------------------------------------
// generateGuideMarkdown テスト
// ---------------------------------------------------------------------------

describe('generateGuideMarkdown', () => {
  test('全定数名が生成 Markdown に含まれること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    for (const key of Object.keys(BOUNDARY_CONTEXT_MAP)) {
      expect(md).toContain(key);
    }
  });

  test('STRING_EDGES が改行なし（❌）として記載されること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    // STRING_EDGES の行には includesNewline=false を示す「—」が含まれる
    expect(md).toContain('STRING_EDGES');
    expect(md).toContain('改行含む');
    // STRING_EDGES 行の改行セルが「—」であることを確認
    const lines = md.split('\n');
    const stringEdgeLine = lines.find((l) => l.includes('`STRING_EDGES`'));
    expect(stringEdgeLine).toBeDefined();
    expect(stringEdgeLine).toContain('—');
  });

  test('BOUNDARY_STRINGS が改行あり（✅）として記載されること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    const lines = md.split('\n');
    const boundaryStringsLine = lines.find((l) => l.includes('`BOUNDARY_STRINGS`'));
    expect(boundaryStringsLine).toBeDefined();
    expect(boundaryStringsLine).toContain('✅');
  });

  test('TIME_BOUNDARIES が reserved ステータスで記載されること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    expect(md).toContain('reserved');
    const lines = md.split('\n');
    const timeLine = lines.find((l) => l.includes('`TIME_BOUNDARIES`'));
    expect(timeLine).toBeDefined();
    expect(timeLine).toContain('reserved');
  });

  test('NUMERIC_ID_BOUNDARIES が大値含む（✅）として記載されること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    const lines = md.split('\n');
    const numericLine = lines.find((l) => l.includes('`NUMERIC_ID_BOUNDARIES`'));
    expect(numericLine).toBeDefined();
    expect(numericLine).toContain('✅');
  });

  test('同一 Map から同じ出力が得られること（決定的）', () => {
    const md1 = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    const md2 = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    expect(md1).toBe(md2);
  });

  test('自動生成ヘッダーコメントが含まれること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    expect(md).toContain('自動生成');
    expect(md).toContain('gen-boundary-guide');
  });

  test('選択フローセクションが含まれること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    expect(md).toContain('選択フロー');
    expect(md).toContain('STRING_EDGES');
    expect(md).toContain('BOUNDARY_STRINGS');
  });

  test('STRING_EDGES vs BOUNDARY_STRINGS の使い分けセクションが含まれること', () => {
    const md = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    expect(md).toContain('STRING_EDGES` vs `BOUNDARY_STRINGS');
    expect(md).toContain('改行');
  });

  test('空 Map を渡すと定数一覧テーブルが空の Markdown が生成されること', () => {
    const md = generateGuideMarkdown({});
    expect(md).toContain('選択ガイド');
    // 定数一覧テーブルのヘッダーは存在しない（グループがないため）
    expect(md).not.toContain('| 定数名 | 改行含む');
  });

  test('単一エントリ Map でもクラッシュしないこと', () => {
    const singleMap: Readonly<Record<string, BoundaryConstMeta>> = {
      TEST_CONST: {
        constName: 'TEST_CONST',
        inputType: 'string',
        includesNewline: false,
        includesLargeValue: false,
        useFor: 'テスト用定数',
        genUsed: false,
        status: 'active',
      },
    };
    const md = generateGuideMarkdown(singleMap);
    expect(md).toContain('TEST_CONST');
  });
});

// ---------------------------------------------------------------------------
// checkDrift テスト
// ---------------------------------------------------------------------------

describe('checkDrift', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `guide-drift-test-${process.pid}.md`);
  });

  afterEach(() => {
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });

  test('ファイルが存在しない場合は status:"missing" を返すこと', () => {
    const result = checkDrift(tmpFile);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<DriftResult>({ file: tmpFile, status: 'missing' });
  });

  test('ファイルの内容が期待値と一致する場合は空配列を返すこと', () => {
    const expected = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    writeFileSync(tmpFile, expected, 'utf-8');
    const result = checkDrift(tmpFile);
    expect(result).toHaveLength(0);
  });

  test('ファイルの内容が期待値と異なる場合は status:"mismatch" を返すこと', () => {
    writeFileSync(tmpFile, '# 改変されたガイド\n全然違う内容', 'utf-8');
    const result = checkDrift(tmpFile);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<DriftResult>({ file: tmpFile, status: 'mismatch' });
  });

  test('空ファイルは mismatch として検出されること', () => {
    writeFileSync(tmpFile, '', 'utf-8');
    const result = checkDrift(tmpFile);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('mismatch');
  });
});

// ---------------------------------------------------------------------------
// parseFilesArg テスト
// ---------------------------------------------------------------------------

describe('parseFilesArg', () => {
  test('--files= 形式で複数ファイルをパースできること', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files=a.ts,b.ts']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  test('--files フラグが存在しない場合は null を返すこと', () => {
    const result = parseFilesArg(['node', 'script.ts', '--check']);
    expect(result).toBeNull();
  });

  test('--files= の値が空文字の場合は空配列を返すこと', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files=']);
    expect(result).toEqual([]);
  });

  test('スペース区切り形式でファイルをパースできること', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files', 'a.ts', 'b.ts']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });

  test('スペース区切り形式でフラグ（--check）の手前で止まること', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files', 'a.ts', '--check']);
    expect(result).toEqual(['a.ts']);
  });

  test('前後のスペースをトリムすること', () => {
    const result = parseFilesArg(['node', 'script.ts', '--files= a.ts , b.ts ']);
    expect(result).toEqual(['a.ts', 'b.ts']);
  });
});
