/**
 * boundary-values.test.ts
 *
 * `tests/helpers/boundary-values.ts` のユニットテスト。
 * 各定数の型整合性・toNameTuples のタプル化・%s 整形を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  STRING_EDGES,
  ID_EDGES,
  NONEXISTENT_ID,
  INVALID_ID_EDGES,
  BOUNDARY_STRINGS,
  DATE_EDGES,
  ENUM_INVALID_EDGES,
  FLOAT_EDGES,
  PG_INT_BOUNDARIES,
  toNameTuples,
  makeEnumBoundaries,
} from './boundary-values';

// ---------------------------------------------------------------------------
// STRING_EDGES
// ---------------------------------------------------------------------------
describe('STRING_EDGES', () => {
  test('各要素が label: string と input: string を持つこと', () => {
    for (const c of STRING_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('string');
    }
  });

  test("空文字列 ('') ケースが含まれること", () => {
    const found = STRING_EDGES.find((c) => c.value === '');
    expect(found).toBeDefined();
  });

  test("半角スペース (' ') ケースが含まれること", () => {
    const found = STRING_EDGES.find((c) => c.value === ' ');
    expect(found).toBeDefined();
  });

  test("タブ文字 ('\\t') ケースが含まれること", () => {
    const found = STRING_EDGES.find((c) => c.value === '\t');
    expect(found).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = STRING_EDGES.map((c) => c.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// ID_EDGES
// ---------------------------------------------------------------------------
describe('ID_EDGES', () => {
  test('各要素が label: string と input: number を持つこと', () => {
    for (const c of ID_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('number');
    }
  });

  test('ゼロ (0) ケースが含まれること', () => {
    const found = ID_EDGES.find((c) => c.value === 0);
    expect(found).toBeDefined();
  });

  test('負数 (-1) ケースが含まれること', () => {
    const found = ID_EDGES.find((c) => c.value === -1);
    expect(found).toBeDefined();
  });

  test('最小正常値 (1) ケースが含まれること', () => {
    const found = ID_EDGES.find((c) => c.value === 1);
    expect(found).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = ID_EDGES.map((c) => c.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// NONEXISTENT_ID
// ---------------------------------------------------------------------------
describe('NONEXISTENT_ID', () => {
  test('number 型であること', () => {
    expect(typeof NONEXISTENT_ID).toBe('number');
  });

  test('値が 999 であること', () => {
    expect(NONEXISTENT_ID).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// INVALID_ID_EDGES
// ---------------------------------------------------------------------------
describe('INVALID_ID_EDGES', () => {
  test('各要素が label: string と value: number を持つこと', () => {
    for (const c of INVALID_ID_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('number');
    }
  });

  test('全ての value が 0 以下（非正 ID）であること', () => {
    for (const c of INVALID_ID_EDGES) {
      expect(c.value).toBeLessThanOrEqual(0);
    }
  });

  test('ゼロ (0) ケースが含まれること', () => {
    const found = INVALID_ID_EDGES.find((c) => c.value === 0);
    expect(found).toBeDefined();
  });

  test('負数 (-1) ケースが含まれること', () => {
    const found = INVALID_ID_EDGES.find((c) => c.value === -1);
    expect(found).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = INVALID_ID_EDGES.map((c) => c.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY_STRINGS
// ---------------------------------------------------------------------------
describe('BOUNDARY_STRINGS', () => {
  test('件数が 5 件であること（\r\n 追加後）', () => {
    expect(BOUNDARY_STRINGS.length).toBe(5);
  });

  test('空文字ケースが含まれること', () => {
    expect(BOUNDARY_STRINGS.find((c) => c.value === '')).toBeDefined();
  });

  test('CRLF改行 (\\r\\n) ケースが含まれること', () => {
    expect(BOUNDARY_STRINGS.find((c) => c.value === '\r\n')).toBeDefined();
  });

  test('既存の4件（空文字・空白・タブ・改行）が保持されていること', () => {
    const values = BOUNDARY_STRINGS.map((c) => c.value);
    expect(values).toContain('');
    expect(values).toContain(' ');
    expect(values).toContain('\t');
    expect(values).toContain('\n');
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = BOUNDARY_STRINGS.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// DATE_EDGES
// ---------------------------------------------------------------------------
describe('DATE_EDGES', () => {
  test('各要素が label: string と value: string を持つこと', () => {
    for (const c of DATE_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('string');
    }
  });

  test('Unix epoch の ISO 文字列が含まれること', () => {
    const found = DATE_EDGES.find((c) => c.value === '1970-01-01T00:00:00.000Z');
    expect(found).toBeDefined();
  });

  test('空文字（無効パース）ケースが含まれること', () => {
    const found = DATE_EDGES.find((c) => c.value === '');
    expect(found).toBeDefined();
  });

  test('epoch ISO 文字列が new Date() で正しくパースされること', () => {
    const epochCase = DATE_EDGES.find((c) => c.value === '1970-01-01T00:00:00.000Z');
    expect(new Date(epochCase!.value).getTime()).toBe(0);
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = DATE_EDGES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// ENUM_INVALID_EDGES
// ---------------------------------------------------------------------------
describe('ENUM_INVALID_EDGES', () => {
  test('各要素が label: string と value: string を持つこと', () => {
    for (const c of ENUM_INVALID_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('string');
    }
  });

  test('空文字ケースが含まれること', () => {
    expect(ENUM_INVALID_EDGES.find((c) => c.value === '')).toBeDefined();
  });

  test("'invalid_status' ケースが含まれること", () => {
    expect(ENUM_INVALID_EDGES.find((c) => c.value === 'invalid_status')).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = ENUM_INVALID_EDGES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// FLOAT_EDGES
// ---------------------------------------------------------------------------
describe('FLOAT_EDGES', () => {
  test('各要素が label: string と value: number を持つこと', () => {
    for (const c of FLOAT_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('number');
    }
  });

  test('NaN ケースが含まれること', () => {
    const found = FLOAT_EDGES.find((c) => Number.isNaN(c.value));
    expect(found).toBeDefined();
  });

  test('正の無限大ケースが含まれること', () => {
    const found = FLOAT_EDGES.find((c) => c.value === Number.POSITIVE_INFINITY);
    expect(found).toBeDefined();
  });

  test('負の無限大ケースが含まれること', () => {
    const found = FLOAT_EDGES.find((c) => c.value === Number.NEGATIVE_INFINITY);
    expect(found).toBeDefined();
  });

  test('EPSILON ケースが含まれること', () => {
    const found = FLOAT_EDGES.find((c) => c.value === Number.EPSILON);
    expect(found).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = FLOAT_EDGES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// PG_INT_BOUNDARIES
// ---------------------------------------------------------------------------
describe('PG_INT_BOUNDARIES', () => {
  test('各要素が label: string と value: number を持つこと', () => {
    for (const c of PG_INT_BOUNDARIES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.value).toBe('number');
    }
  });

  test('INT4 最大値 (2147483647) が含まれること', () => {
    const found = PG_INT_BOUNDARIES.find((c) => c.value === 2147483647);
    expect(found).toBeDefined();
  });

  test('INT4 最小値 (-2147483648) が含まれること', () => {
    const found = PG_INT_BOUNDARIES.find((c) => c.value === -2147483648);
    expect(found).toBeDefined();
  });

  test('INT4 オーバーフロー (2147483648) が含まれること', () => {
    const found = PG_INT_BOUNDARIES.find((c) => c.value === 2147483648);
    expect(found).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = PG_INT_BOUNDARIES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// makeEnumBoundaries
// ---------------------------------------------------------------------------
describe('makeEnumBoundaries', () => {
  const TEST_STATUSES = ['open', 'closed', 'in_progress'] as const;
  type TestStatus = (typeof TEST_STATUSES)[number];

  test('valid ケースを Enum 値の数だけ生成すること', () => {
    const boundaries = makeEnumBoundaries<TestStatus>(TEST_STATUSES);
    expect(boundaries.valid.length).toBe(TEST_STATUSES.length);
  });

  test('valid の各ケースの value が Enum 値と一致すること', () => {
    const boundaries = makeEnumBoundaries<TestStatus>(TEST_STATUSES);
    for (let i = 0; i < TEST_STATUSES.length; i++) {
      expect(boundaries.valid[i].value).toBe(TEST_STATUSES[i]);
    }
  });

  test('invalid 省略時は ENUM_INVALID_EDGES を返すこと', () => {
    const boundaries = makeEnumBoundaries<TestStatus>(TEST_STATUSES);
    expect(boundaries.invalid).toBe(ENUM_INVALID_EDGES);
  });

  test('invalid 指定時は指定したサンプルを返すこと', () => {
    const custom = [{ label: 'カスタム', value: 'custom_invalid' }] as const;
    const boundaries = makeEnumBoundaries<TestStatus>(TEST_STATUSES, custom);
    expect(boundaries.invalid).toBe(custom);
  });

  test('空の validValues を渡すと valid が空配列になること', () => {
    const boundaries = makeEnumBoundaries<never>([], []);
    expect(boundaries.valid).toEqual([]);
    expect(boundaries.invalid).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toNameTuples
// ---------------------------------------------------------------------------
describe('toNameTuples', () => {
  test('BoundaryCase<string>[] → [string, string][] に変換されること', () => {
    const tuples = toNameTuples(STRING_EDGES);
    expect(tuples.length).toBe(STRING_EDGES.length);
    for (const [label, input] of tuples) {
      expect(typeof label).toBe('string');
      expect(typeof input).toBe('string');
    }
  });

  test('BoundaryCase<number>[] → [string, number][] に変換されること', () => {
    const tuples = toNameTuples(ID_EDGES);
    expect(tuples.length).toBe(ID_EDGES.length);
    for (const [label, input] of tuples) {
      expect(typeof label).toBe('string');
      expect(typeof input).toBe('number');
    }
  });

  test('各タプルの第 1 要素が元ケースの label と一致すること（%s 整形確認）', () => {
    const tuples = toNameTuples(STRING_EDGES);
    for (let i = 0; i < STRING_EDGES.length; i++) {
      expect(tuples[i][0]).toBe(STRING_EDGES[i].label);
    }
  });

  test('各タプルの第 2 要素が元ケースの value と一致すること', () => {
    const tuples = toNameTuples(ID_EDGES);
    for (let i = 0; i < ID_EDGES.length; i++) {
      expect(tuples[i][1]).toBe(ID_EDGES[i].value);
    }
  });

  test('空配列を渡すと空配列を返すこと', () => {
    expect(toNameTuples([])).toEqual([]);
  });

  test('note フィールドはタプルに含まれないこと', () => {
    const cases = [{ label: 'テスト', value: 'x', note: '注記' }];
    const tuples = toNameTuples(cases);
    expect(tuples[0]).toHaveLength(2);
    expect(tuples[0][0]).toBe('テスト');
    expect(tuples[0][1]).toBe('x');
  });
});
