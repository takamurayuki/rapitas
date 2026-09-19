import { describe, expect, test } from 'bun:test';
import {
  renderGatePrecisionDisputes,
  type GatePrecisionDispute,
} from './workflow-gate-precision-context';

describe('renderGatePrecisionDisputes', () => {
  test('empty items renders nothing', () => {
    expect(renderGatePrecisionDisputes([], 'ja')).toBe('');
  });

  test('renders ja section with criterion index and reason', () => {
    const items: GatePrecisionDispute[] = [
      { taskTitle: 'タスクA', criterionIndex: 2, reason: '検証差し戻しの理由', unresolved: false },
    ];
    const out = renderGatePrecisionDisputes(items, 'ja');
    expect(out).toContain('タスクA');
    expect(out).toContain('#2');
    expect(out).toContain('検証差し戻しの理由');
    expect(out).not.toContain('（未解決）');
  });

  test('marks unresolved disputes distinctly', () => {
    const items: GatePrecisionDispute[] = [
      { taskTitle: 'タスクB', criterionIndex: 1, reason: 'まだブロック中', unresolved: true },
    ];
    const out = renderGatePrecisionDisputes(items, 'ja');
    expect(out).toContain('未解決');
  });

  test('falls back to "?" when the criterion index is unknown', () => {
    const items: GatePrecisionDispute[] = [
      { taskTitle: 'タスクC', criterionIndex: null, reason: 'reason', unresolved: false },
    ];
    const out = renderGatePrecisionDisputes(items, 'ja');
    expect(out).toContain('#?');
  });

  test('renders en section', () => {
    const items: GatePrecisionDispute[] = [
      { taskTitle: 'Task D', criterionIndex: 3, reason: 'bounce reason', unresolved: true },
    ];
    const out = renderGatePrecisionDisputes(items, 'en');
    expect(out).toContain('Task D');
    expect(out).toContain('#3');
    expect(out).toContain('(unresolved)');
  });
});
