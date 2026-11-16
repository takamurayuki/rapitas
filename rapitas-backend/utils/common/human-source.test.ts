/**
 * human-source tests
 */
import { describe, expect, test } from 'bun:test';
import { humanSourceLabel } from './human-source';

const LABELS = { ui: 'ユーザー操作', operator: 'オペレーター代理' };

describe('humanSourceLabel', () => {
  test('resolves the allowed sources case-insensitively', () => {
    expect(humanSourceLabel('ui', LABELS)).toBe('ユーザー操作');
    expect(humanSourceLabel('UI', LABELS)).toBe('ユーザー操作');
    expect(humanSourceLabel('Operator', LABELS)).toBe('オペレーター代理');
  });

  test('refuses anything else, including inherited object keys', () => {
    for (const raw of ['', 'assistant', 'rapi', 'agent', 'constructor', '__proto__', 'tostring']) {
      expect(humanSourceLabel(raw, LABELS)).toBeUndefined();
    }
    expect(humanSourceLabel(undefined, LABELS)).toBeUndefined();
    expect(humanSourceLabel(['ui'], LABELS)).toBeUndefined();
  });
});
