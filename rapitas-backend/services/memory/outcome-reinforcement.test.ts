/**
 * outcome-reinforcement.test
 *
 * Verifies the retrieval→outcome trace bookkeeping: entries used by a task are
 * counted once, merged across multiple retrievals, and the trace is cleared
 * after the outcome is applied. The decay primitives (boost/penalize) are no-ops
 * here for non-existent ids — forgetting.ts returns early when the entry is not
 * found — so no module mock (which would leak process-globally) is needed.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  recordRetrieval,
  applyOutcomeReinforcement,
  mergeKnowledgeUsage,
  _resetTraces,
} from './outcome-reinforcement';

describe('outcome-reinforcement', () => {
  beforeEach(() => {
    _resetTraces();
  });

  test('success applies to every retrieved entry once', async () => {
    recordRetrieval(1, [10, 11, 12]);
    expect(await applyOutcomeReinforcement(1, true)).toBe(3);
  });

  test('failure applies to every retrieved entry', async () => {
    recordRetrieval(2, [20, 21]);
    expect(await applyOutcomeReinforcement(2, false)).toBe(2);
  });

  test('merges entries across multiple retrievals and de-dups ids', async () => {
    recordRetrieval(3, [30, 31]);
    recordRetrieval(3, [31, 32]); // 31 repeated within the same task run
    expect(await applyOutcomeReinforcement(3, true)).toBe(3); // 30,31,32
  });

  test('clears the trace after applying — a second outcome is a no-op', async () => {
    recordRetrieval(4, [40]);
    expect(await applyOutcomeReinforcement(4, true)).toBe(1);
    expect(await applyOutcomeReinforcement(4, true)).toBe(0);
  });

  test('no trace → no-op (best-effort after a restart drops the trace)', async () => {
    expect(await applyOutcomeReinforcement(999, true)).toBe(0);
  });

  test('ignores empty retrievals and non-integer task ids', async () => {
    recordRetrieval(5, []);
    recordRetrieval(Number.NaN, [50]);
    expect(await applyOutcomeReinforcement(5, true)).toBe(0);
  });
});

describe('parseKnowledgeUsage (R8 usage declaration)', () => {
  test('使用知識セクションから used / wrong を抽出する', async () => {
    const { parseKnowledgeUsage } = await import('./outcome-reinforcement');
    const md = [
      '# 検証レポート',
      '本文...',
      '## 使用知識',
      '- K-10',
      '- K-11: 誤り — 現在のスキーマと矛盾',
      '- K-12',
      '',
      '## 別のセクション',
      '- K-99 これは数えない',
    ].join('\n');
    const u = parseKnowledgeUsage(md);
    expect(u.declared).toBe(true);
    expect(u.used.sort()).toEqual([10, 12]);
    expect(u.wrong).toEqual([11]);
  });

  test('セクションが無ければ declared:false', async () => {
    const { parseKnowledgeUsage } = await import('./outcome-reinforcement');
    expect(parseKnowledgeUsage('# 検証\nK-10 を使った')).toEqual({
      declared: false,
      used: [],
      wrong: [],
    });
    expect(parseKnowledgeUsage(null).declared).toBe(false);
  });

  test('英語見出し Knowledge Used / wrong マーカーも解釈する', async () => {
    const { parseKnowledgeUsage } = await import('./outcome-reinforcement');
    const u = parseKnowledgeUsage('## Knowledge Used\n- K-5\n- K-6: wrong, outdated API');
    expect(u.declared).toBe(true);
    expect(u.used).toEqual([5]);
    expect(u.wrong).toEqual([6]);
  });
});

describe('applyOutcomeReinforcement — 細粒度クレジット割当 (R8)', () => {
  beforeEach(() => {
    _resetTraces();
  });

  test('申告あり: used と wrong のみ反映、未申告の注入分は中立', async () => {
    recordRetrieval(60, [10, 11, 12]);
    const applied = await applyOutcomeReinforcement(60, true, {
      declared: true,
      used: [10],
      wrong: [11],
    });
    expect(applied).toBe(2); // 12 is injected-but-undeclared → neutral
  });

  test('申告に注入されていないIDがあっても反映されない（トレースと交差）', async () => {
    recordRetrieval(61, [20]);
    const applied = await applyOutcomeReinforcement(61, true, {
      declared: true,
      used: [999],
      wrong: [998],
    });
    expect(applied).toBe(0);
  });

  test('申告なし（declared:false）はレガシーの一律反映', async () => {
    recordRetrieval(62, [30, 31]);
    const applied = await applyOutcomeReinforcement(62, false, {
      declared: false,
      used: [],
      wrong: [],
    });
    expect(applied).toBe(2);
  });
});

describe('mergeKnowledgeUsage — 複数成果物の申告統合', () => {
  test('research/plan/verify の申告を union する', () => {
    const merged = mergeKnowledgeUsage([
      { declared: true, used: [1, 2], wrong: [] }, // research.md
      { declared: false, used: [], wrong: [] }, // plan.md (no section)
      { declared: true, used: [2, 3], wrong: [4] }, // verify.md
    ]);
    expect(merged.declared).toBe(true);
    expect(merged.used.sort()).toEqual([1, 2, 3]);
    expect(merged.wrong).toEqual([4]);
  });

  test('どのフェーズかで wrong と used が割れたら wrong が勝つ', () => {
    const merged = mergeKnowledgeUsage([
      { declared: true, used: [5], wrong: [] },
      { declared: true, used: [], wrong: [5] },
    ]);
    expect(merged.used).toEqual([]);
    expect(merged.wrong).toEqual([5]);
  });

  test('全成果物が未申告なら declared:false（レガシー一律反映へ）', () => {
    const merged = mergeKnowledgeUsage([
      { declared: false, used: [], wrong: [] },
      { declared: false, used: [], wrong: [] },
    ]);
    expect(merged.declared).toBe(false);
  });

  test('空配列は declared:false', () => {
    expect(mergeKnowledgeUsage([]).declared).toBe(false);
  });
});
