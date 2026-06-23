/**
 * hypothesis-from-verify ユニットテスト
 *
 * verify.md の `## 仮説評価` から成立/不成立の判定を抽出し、decisive 証拠として
 * 昇格/却下に流す経路を検証する。
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// addEvidence 呼び出しを捕捉する（実DBを叩かない）
const evidenceCalls: Array<{ id: number; stance: string; decisive?: boolean }> = [];
// id-less verdict のマッチング用に返す open 仮説（テストで差し替え）
let openHyps: Array<{ id: number; statement: string; originTaskId: number }> = [];
mock.module('./hypothesis-service', () => ({
  addEvidence: (id: number, ev: { stance: string; decisive?: boolean }) => {
    evidenceCalls.push({ id, stance: ev.stance, decisive: ev.decisive });
    return Promise.resolve({ ok: true, confidence: 0.8, status: 'supported', graduated: true });
  },
  listHypotheses: () => Promise.resolve({ hypotheses: openHyps }),
}));
mock.module('../../config/database', () => ({
  prisma: { task: { findUnique: () => Promise.resolve({ themeId: 1 }) } },
}));

const { extractHypothesisVerdicts, applyHypothesisVerdictsFromVerify } =
  await import('./hypothesis-from-verify');

describe('extractHypothesisVerdicts', () => {
  test('## 仮説評価 配下の成立/不成立を #id 付きで抽出する', () => {
    const md = [
      '# 検証レポート',
      '## テスト結果',
      '- 失敗テスト数: 0',
      '## 仮説評価',
      '- [#2854] 成立: 正規表現で7resolver生成できた (generate-resolver.test.ts)',
      '- #2931 不成立 — X が想定と異なった',
      '- [#2999] 保留: まだ判断できない',
      '## 次のステップ',
      '- [#1234] 成立: このセクション外なので無視',
    ].join('\n');
    const v = extractHypothesisVerdicts(md);
    expect(v).toHaveLength(2); // 保留 は除外、セクション外も除外
    expect(v[0]).toMatchObject({ hypothesisId: 2854, verdict: 'confirmed' });
    expect(v[1]).toMatchObject({ hypothesisId: 2931, verdict: 'refuted' });
  });

  test('#id アンカーが無い行は hypothesisId=null で保持し、後段の命題一致に回す', () => {
    const md = '## 仮説評価\n- 成立: but no id\n- [#42] 成立: ok';
    const v = extractHypothesisVerdicts(md);
    expect(v).toHaveLength(2);
    expect(v[0].hypothesisId).toBeNull();
    expect(v[1].hypothesisId).toBe(42);
  });

  test('セクションが無ければ空', () => {
    expect(extractHypothesisVerdicts('# 検証レポート\n- 何もなし')).toEqual([]);
    expect(extractHypothesisVerdicts(null)).toEqual([]);
  });
});

describe('applyHypothesisVerdictsFromVerify', () => {
  test('各判定を decisive 証拠として addEvidence に流す（成立=for / 不成立=against）', async () => {
    evidenceCalls.length = 0;
    const md = '## 仮説評価\n- [#2854] 成立: ok (a.ts:1)\n- [#2931] 不成立: ng';
    const n = await applyHypothesisVerdictsFromVerify(7, md);
    expect(n).toBe(2);
    expect(evidenceCalls).toEqual([
      { id: 2854, stance: 'for', decisive: true },
      { id: 2931, stance: 'against', decisive: true },
    ]);
  });

  test('判定が無ければ addEvidence を呼ばない', async () => {
    evidenceCalls.length = 0;
    openHyps = [];
    const n = await applyHypothesisVerdictsFromVerify(7, '# 検証レポート\n- なし');
    expect(n).toBe(0);
    expect(evidenceCalls).toHaveLength(0);
  });

  test('[#id] 無し（[domain] で言い換え）でも命題一致で解決して昇格する', async () => {
    evidenceCalls.length = 0;
    // 実際に観測されたドリフト: verifier が [#id] でなく [domain] statement で記述
    openHyps = [
      {
        id: 3097,
        statement: 'makeStringTypeGuard を utils/common に配置すると循環依存は生じない',
        originTaskId: 7,
      },
      {
        id: 3099,
        statement: 'workflow-orchestrator の 7件の as WorkflowStatus は全て安全除去可能',
        originTaskId: 7,
      },
    ];
    const md = [
      '## 仮説評価',
      '- [architecture] makeStringTypeGuard を utils/common に配置 → 循環依存なし: **成立** — tsc exit 0',
      '- [codebase] 7件の as WorkflowStatus は全て安全除去可能: **不成立** — 実際は1件のみ',
    ].join('\n');
    const n = await applyHypothesisVerdictsFromVerify(7, md);
    expect(n).toBe(2);
    expect(evidenceCalls).toEqual([
      { id: 3097, stance: 'for', decisive: true },
      { id: 3099, stance: 'against', decisive: true },
    ]);
  });

  test('命題一致が弱い id-less 判定は誤昇格せずスキップ', async () => {
    evidenceCalls.length = 0;
    openHyps = [{ id: 5000, statement: '全く無関係なトピックについての命題', originTaskId: 7 }];
    const md = '## 仮説評価\n- [perf] short: 成立';
    const n = await applyHypothesisVerdictsFromVerify(7, md);
    expect(n).toBe(0);
    expect(evidenceCalls).toHaveLength(0);
  });
});
