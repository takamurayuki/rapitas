/**
 * boundary-values.test.ts
 *
 * `tests/helpers/boundary-values.ts` のユニットテスト。
 * 各定数の型整合性・toNameTuples のタプル化・%s 整形を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { STRING_EDGES, ID_EDGES, toNameTuples } from './boundary-values';

// ---------------------------------------------------------------------------
// STRING_EDGES
// ---------------------------------------------------------------------------
describe('STRING_EDGES', () => {
  test('各要素が label: string と input: string を持つこと', () => {
    for (const c of STRING_EDGES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.input).toBe('string');
    }
  });

  test('空文字列 (\'\') ケースが含まれること', () => {
    const found = STRING_EDGES.find((c) => c.input === '');
    expect(found).toBeDefined();
  });

  test('半角スペース (\' \') ケースが含まれること', () => {
    const found = STRING_EDGES.find((c) => c.input === ' ');
    expect(found).toBeDefined();
  });

  test('タブ文字 (\'\\t\') ケースが含まれること', () => {
    const found = STRING_EDGES.find((c) => c.input === '\t');
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
      expect(typeof c.input).toBe('number');
    }
  });

  test('ゼロ (0) ケースが含まれること', () => {
    const found = ID_EDGES.find((c) => c.input === 0);
    expect(found).toBeDefined();
  });

  test('負数 (-1) ケースが含まれること', () => {
    const found = ID_EDGES.find((c) => c.input === -1);
    expect(found).toBeDefined();
  });

  test('最小正常値 (1) ケースが含まれること', () => {
    const found = ID_EDGES.find((c) => c.input === 1);
    expect(found).toBeDefined();
  });

  test('全ケースのラベルが一意であること', () => {
    const labels = ID_EDGES.map((c) => c.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
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

  test('各タプルの第 2 要素が元ケースの input と一致すること', () => {
    const tuples = toNameTuples(ID_EDGES);
    for (let i = 0; i < ID_EDGES.length; i++) {
      expect(tuples[i][1]).toBe(ID_EDGES[i].input);
    }
  });

  test('空配列を渡すと空配列を返すこと', () => {
    expect(toNameTuples([])).toEqual([]);
  });

  test('note フィールドはタプルに含まれないこと', () => {
    const cases = [{ label: 'テスト', input: 'x', note: '注記' }];
    const tuples = toNameTuples(cases);
    expect(tuples[0]).toHaveLength(2);
    expect(tuples[0][0]).toBe('テスト');
    expect(tuples[0][1]).toBe('x');
  });
});
