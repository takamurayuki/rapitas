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
    { label: 'regular string', value: 'hello' as string, expected: '`"hello"`' },
  ])('$label', ({ value, expected }) => {
    expect(renderValue(value)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// generateGuideContent
// ---------------------------------------------------------------------------
describe('generateGuideContent', () => {
  test('includes the auto-generated header', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain('自動生成ファイル');
    expect(content).toContain('gen-boundary-guide');
  });

  test('includes all section headings', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    const headings = [
      '### `STRING_EDGES`',
      '### `ID_EDGES`',
      '### `NUMERIC_ID_BOUNDARIES`',
      '### `BOUNDARY_STRINGS`',
      '### `TIME_BOUNDARIES`',
      '### `NULLABLE_ID_EDGES`',
      '### `INVALID_ID_EDGES`',
      '### `NONEXISTENT_ID`',
    ];
    for (const h of headings) {
      expect(content).toContain(h);
    }
  });

  test('renders SSOT path in header', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain(SSOT_RELATIVE);
  });

  test('renders NONEXISTENT_ID value', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain('`999`');
  });

  test('renders null value for NULLABLE_ID_EDGES', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain('`null`');
  });

  test('renders case labels in table rows', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain('| 空文字列 |');
    expect(content).toContain('| id=0 |');
  });

  test('renders notes when present', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain('mock null 前提');
  });

  test('renders empty note cell when note is absent', () => {
    const content = generateGuideContent({
      ...MINIMAL_INPUT,
      ID_EDGES: [{ label: 'id=0', value: 0 }],
    });
    expect(content).toContain('| id=0 | `0` |  |');
  });

  test('includes toNameTuples documentation', () => {
    const content = generateGuideContent(MINIMAL_INPUT);
    expect(content).toContain('toNameTuples');
  });

  test('is deterministic (same input → same output)', () => {
    const a = generateGuideContent(MINIMAL_INPUT);
    const b = generateGuideContent(MINIMAL_INPUT);
    expect(a).toBe(b);
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
