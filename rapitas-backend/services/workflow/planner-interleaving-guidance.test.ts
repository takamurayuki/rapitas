/**
 * planner-interleaving-guidance.test
 *
 * Tasks 1519 / 1521 (2026-11-20/21) bounced round after round because each
 * reviewer found one more interleaving on a lock file the plan had never
 * listed. The planner is now asked for every check-then-act step on shared
 * state, and the verifier checks the table it produced.
 */
import { describe, expect, test } from 'bun:test';
import {
  INTERLEAVING_HEADING,
  plannerInterleavingGuidance,
  withInterleavingCheck,
} from './planner-interleaving-guidance';

describe('plannerInterleavingGuidance', () => {
  test.each(['ja', 'en'])('asks for every check-then-act step, not a top 3 (%s)', (lang) => {
    const text = plannerInterleavingGuidance(lang);
    expect(text).toContain(INTERLEAVING_HEADING);
    // The three interleavers that 1519/1521 found one round at a time.
    expect(text).toMatch(/二重起動|double start/);
    expect(text).toMatch(/起動と停止|start vs stop/);
    expect(text).toMatch(/再起動|restart/);
    // Deterministic reproduction, not racing real processes.
    expect(text).toMatch(/注入|inject/i);
  });
});

describe('withInterleavingCheck', () => {
  const table = `${INTERLEAVING_HEADING}\n\n| 確認→操作 | 割り込み | 残るもの | 守り方 | テスト |\n| --- | --- | --- | --- | --- |\n| ロック読込→削除 | dev-all の引き継ぎ | なし | 再確認つき削除 | pidfile.test.mjs |`;

  test('adds the cross-check when the plan has the table', () => {
    const out = withInterleavingCheck('BASE', `# plan\n\n${table}`, 'ja');
    expect(out.startsWith('BASE')).toBe(true);
    expect(out).toContain('状態と割り込みの照合');
    expect(out).toContain('許容');
  });

  test('leaves the instruction alone without the table', () => {
    expect(withInterleavingCheck('BASE', '# plan\n\n## プレモーテム', 'ja')).toBe('BASE');
    expect(withInterleavingCheck('BASE', null, 'ja')).toBe('BASE');
  });

  test('leaves it alone when the planner wrote 対象なし', () => {
    const plan = `# plan\n\n${INTERLEAVING_HEADING}: 対象なし（画面の文言だけを変える）\n\n## 次`;
    expect(withInterleavingCheck('BASE', plan, 'ja')).toBe('BASE');
  });

  test('speaks English for an English prompt', () => {
    expect(withInterleavingCheck('BASE', table, 'en')).toContain('Interleaving cross-check');
  });
});

// 2026-11-21 (task 1521): the plan marked the concurrent-takeover window of a
// double-start guard as accepted — the one window that lets two starts both
// run. The verifier honoured it; the diff review rightly did not.
describe('what may be accepted', () => {
  test.each(['ja', 'en'])('never a window that defeats an acceptance criterion (%s)', (lang) => {
    const text = plannerInterleavingGuidance(lang);
    expect(text).toMatch(/受入条件|acceptance criterion/);
    expect(text).toMatch(/許容しない|never accept/i);
  });

  test('the verifier checks that an accepted window does not defeat a criterion', () => {
    const table = `${INTERLEAVING_HEADING}\n\n| a | b | c | d | e |\n| --- | --- | --- | --- | --- |\n| x | y | z | 許容 | t |`;
    expect(withInterleavingCheck('BASE', table, 'ja')).toMatch(/受入条件の目的/);
  });
});
