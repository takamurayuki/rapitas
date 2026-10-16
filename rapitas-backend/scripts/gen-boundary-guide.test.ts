/**
 * gen-boundary-guide.test
 *
 * Unit tests for the boundary-guide generator script.
 * Covers parseFilesArg, isSsotChanged, renderValue, generateGuideContent, and checkDrift.
 */

import { describe, test, expect } from 'bun:test';
import {
  parseFilesArg,
  isSsotChanged,
  renderValue,
  generateGuideContent,
  checkDrift,
  extractJsDocDescription,
  loadSsotDescriptions,
  DEFAULT_DESCRIPTIONS,
  SSOT_RELATIVE,
  type BoundaryGuideInput,
} from './gen-boundary-guide';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_INPUT: BoundaryGuideInput = {
  STRING_EDGES: [{ label: '空文字列', value: '', note: 'mock null 前提' }],
  ID_EDGES: [{ label: 'id=0', value: 0 }],
  NUMERIC_ID_BOUNDARIES: [{ label: 'ゼロ', value: 0 }],
  BOUNDARY_STRINGS: [{ label: '空文字', value: '' }],
  TIME_BOUNDARIES: [{ label: 'epoch', value: 0 }],
  NULLABLE_ID_EDGES: [
    { label: 'id=0', value: 0 },
    { label: 'null', value: null },
  ],
  INVALID_ID_EDGES: [{ label: 'id=0', value: 0 }],
  NONEXISTENT_ID: 999,
  DATE_EDGES: [{ label: 'epoch ISO', value: '1970-01-01T00:00:00.000Z' }],
  ENUM_INVALID_EDGES: [{ label: '空文字', value: '' }],
  FLOAT_EDGES: [{ label: 'NaN', value: Number.NaN }],
  PG_INT_BOUNDARIES: [{ label: 'INT4 最大値', value: 2147483647 }],
};

// ---------------------------------------------------------------------------
// parseFilesArg
// ---------------------------------------------------------------------------
describe('parseFilesArg', () => {
  test.each([
    {
      label: '--files flag absent',
      argv: ['bun', 'script.ts', '--check'],
      expected: null,
    },
    {
      label: '--files=a.ts,b.ts comma-separated',
      argv: ['bun', 'script.ts', '--files=a.ts,b.ts'],
      expected: ['a.ts', 'b.ts'],
    },
    {
      label: '--files= empty value',
      argv: ['bun', 'script.ts', '--files='],
      expected: [],
    },
    {
      label: '--files followed by positional args',
      argv: ['bun', 'script.ts', '--files', 'a.ts', 'b.ts'],
      expected: ['a.ts', 'b.ts'],
    },
    {
      label: '--files stops at next flag',
      argv: ['bun', 'script.ts', '--files', 'a.ts', '--check'],
      expected: ['a.ts'],
    },
  ])('$label', ({ argv, expected }) => {
    expect(parseFilesArg(argv)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// isSsotChanged
// ---------------------------------------------------------------------------
describe('isSsotChanged', () => {
  test.each([
    { label: 'exact relative path', files: [SSOT_RELATIVE], expected: true },
    {
      label: 'leading directory prefix',
      files: [`rapitas-backend/${SSOT_RELATIVE}`],
      expected: true,
    },
    {
      label: 'SSOT not in list',
      files: ['services/task/task-resolver.ts', 'routes/tasks.ts'],
      expected: false,
    },
    { label: 'empty list', files: [], expected: false },
  ])('$label → $expected', ({ files, expected }) => {
    expect(isSsotChanged(files)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// renderValue
// ---------------------------------------------------------------------------
describe('renderValue', () => {
  test.each([
    { label: 'null', value: null as null, expected: '`null`' },
    { label: 'zero', value: 0 as number, expected: '`0`' },
    { label: 'negative', value: -1 as number, expected: '`-1`' },
    {
      label: 'MAX_SAFE_INTEGER',
      value: Number.MAX_SAFE_INTEGER,
      expected: `\`${Number.MAX_SAFE_INTEGER}\``,
    },
    { label: 'empty string', value: '' as string, expected: '`""` (空文字)' },
    { label: 'tab char', value: '\t' as string, expected: '`"\\t"`' },
    { label: 'newline char', value: '\n' as string, expected: '`"\\n"`' },
    { label: 'CRLF', value: '\r\n' as string, expected: '`"\\r\\n"`' },
    { label: 'CR only', value: '\r' as string, expected: '`"\\r"`' },
    { label: 'regular string', value: 'hello' as string, expected: '`"hello"`' },
  ])('$label', ({ value, expected }) => {
    expect(renderValue(value)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// generateGuideContent
// ---------------------------------------------------------------------------
describe('generateGuideContent', () => {
  test.each([
    {
      label: 'includes the auto-generated header',
      input: MINIMAL_INPUT,
      expected: ['自動生成ファイル', 'gen-boundary-guide'],
    },
    {
      label: 'includes all section headings',
      input: MINIMAL_INPUT,
      expected: [
        '### `STRING_EDGES`',
        '### `ID_EDGES`',
        '### `NUMERIC_ID_BOUNDARIES`',
        '### `BOUNDARY_STRINGS`',
        '### `TIME_BOUNDARIES`',
        '### `NULLABLE_ID_EDGES`',
        '### `INVALID_ID_EDGES`',
        '### `NONEXISTENT_ID`',
        '### `DATE_EDGES`',
        '### `ENUM_INVALID_EDGES`',
        '### `FLOAT_EDGES`',
        '### `PG_INT_BOUNDARIES`',
      ],
    },
    {
      label: 'renders SSOT path in header',
      input: MINIMAL_INPUT,
      expected: [SSOT_RELATIVE],
    },
    {
      label: 'renders NONEXISTENT_ID value',
      input: MINIMAL_INPUT,
      expected: ['`999`'],
    },
    {
      label: 'renders null value for NULLABLE_ID_EDGES',
      input: MINIMAL_INPUT,
      expected: ['`null`'],
    },
    {
      label: 'renders case labels in table rows',
      input: MINIMAL_INPUT,
      expected: ['| 空文字列 |', '| id=0 |'],
    },
    {
      label: 'renders notes when present',
      input: MINIMAL_INPUT,
      expected: ['mock null 前提'],
    },
    {
      label: 'renders empty note cell when note is absent',
      input: { ...MINIMAL_INPUT, ID_EDGES: [{ label: 'id=0', value: 0 }] },
      expected: ['| id=0 | `0` |  |'],
    },
    {
      label: 'includes toNameTuples documentation',
      input: MINIMAL_INPUT,
      expected: ['toNameTuples'],
    },
  ])('$label', ({ input, expected }) => {
    const content = generateGuideContent(input);
    for (const substring of expected) {
      expect(content).toContain(substring);
    }
  });

  test.each([
    ['見出し', '## 定数の追加手順'],
    ['ステップ 1', 'ステップ 1'],
    ['ステップ 2', 'ステップ 2'],
    ['ステップ 3', 'ステップ 3'],
    ['SSOT パス参照', SSOT_RELATIVE],
    ['gen:boundary-guide コマンド', 'bun run gen:boundary-guide'],
    ['BoundaryGuideInput 登録点', 'BoundaryGuideInput'],
    ['DEFAULT_DESCRIPTIONS 登録点', 'DEFAULT_DESCRIPTIONS'],
    ['checkDrift 登録点', 'checkDrift'],
  ])('how-to section: %s が含まれる', (_label, expected) => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain(expected);
  });

  test('is deterministic (same input → same output)', () => {
    const a = generateGuideContent(MINIMAL_INPUT);
    const b = generateGuideContent(MINIMAL_INPUT);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// extractJsDocDescription
// ---------------------------------------------------------------------------
describe('extractJsDocDescription', () => {
  const SOURCE = `
/**
 * First sentence of STRING_EDGES.
 *
 * Second paragraph.
 * @param x - some param
 */
export const STRING_EDGES = [];

/**
 * First sentence of NONEXISTENT_ID.
 */
export const NONEXISTENT_ID = 999;
`;

  test('extracts first non-empty non-tag line', () => {
    expect(extractJsDocDescription(SOURCE, 'STRING_EDGES', 'fallback')).toBe(
      'First sentence of STRING_EDGES.',
    );
  });

  test('extracts first line for single-line JSDoc', () => {
    expect(extractJsDocDescription(SOURCE, 'NONEXISTENT_ID', 'fallback')).toBe(
      'First sentence of NONEXISTENT_ID.',
    );
  });

  test('returns fallback when export name not found', () => {
    expect(extractJsDocDescription(SOURCE, 'MISSING_CONST', 'my fallback')).toBe('my fallback');
  });

  test('skips @-tag lines', () => {
    const src = `
/**
 * @deprecated
 * Real description.
 */
export const FOO = 1;
`;
    expect(extractJsDocDescription(src, 'FOO', 'fallback')).toBe('Real description.');
  });
});

// ---------------------------------------------------------------------------
// loadSsotDescriptions
// ---------------------------------------------------------------------------
describe('loadSsotDescriptions', () => {
  const MOCK_SSOT = `
/**
 * STRING_EDGES mock description.
 */
export const STRING_EDGES = [];
/**
 * NONEXISTENT_ID mock description.
 */
export const NONEXISTENT_ID = 999;
`;

  test('returns DEFAULT_DESCRIPTIONS when source has no matching exports', () => {
    const descriptions = loadSsotDescriptions('// empty source');
    expect(descriptions).toEqual(DEFAULT_DESCRIPTIONS);
  });

  test('extracts available descriptions and falls back for missing ones', () => {
    const descriptions = loadSsotDescriptions(MOCK_SSOT);
    expect(descriptions.STRING_EDGES).toBe('STRING_EDGES mock description.');
    expect(descriptions.NONEXISTENT_ID).toBe('NONEXISTENT_ID mock description.');
    // ID_EDGES not present in MOCK_SSOT → falls back to DEFAULT
    expect(descriptions.ID_EDGES).toBe(DEFAULT_DESCRIPTIONS.ID_EDGES);
  });

  test('all keys are present', () => {
    const descriptions = loadSsotDescriptions('');
    const expectedKeys: (keyof typeof DEFAULT_DESCRIPTIONS)[] = [
      'STRING_EDGES',
      'ID_EDGES',
      'NUMERIC_ID_BOUNDARIES',
      'BOUNDARY_STRINGS',
      'TIME_BOUNDARIES',
      'NULLABLE_ID_EDGES',
      'INVALID_ID_EDGES',
      'NONEXISTENT_ID',
    ];
    for (const key of expectedKeys) {
      expect(descriptions[key]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// checkDrift (integration: runs against the committed docs/ file)
// ---------------------------------------------------------------------------
describe('checkDrift', () => {
  test('reports no drift against the committed guide', () => {
    const drifts = checkDrift();
    expect(drifts).toEqual([]);
  });
});
