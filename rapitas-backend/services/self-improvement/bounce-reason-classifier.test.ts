/**
 * bounce-reason-classifier.test
 *
 * Pure tests for bounce classification, pattern normalization, aggregation and
 * the gate-misjudgment filer (submitConcern mocked).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const submitConcernMock = mock(
  async (_input: unknown): Promise<unknown> => ({
    outcome: 'created',
  }),
);
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

const {
  classifyBounceReason,
  normalizeBouncePattern,
  bouncePatternId,
  splitSentences,
  extractContradictionSentences,
} = await import('./bounce-reason-classifier');
const { toBounceItem, summarizeBounces, formatBounceBreakdown } =
  await import('./bounce-breakdown');
const { fileGateMisjudgmentCandidates } = await import('./gate-misjudgment-filer');

const pastNegations = [
  '検証レポートは自己矛盾していなかった',
  'verify.md は自己矛盾してなかった',
  '検証結果は自己矛盾ではなかった',
  '検証レポートに自己矛盾はなかった',
  '検証結果は自己矛盾しなかった',
  '検証レポートに自己矛盾は無かった',
  '検証結果が矛盾と判定されたが、矛盾は見当たらなかった',
  '検証レポートは自己矛盾してはいなかった',
];

const politeNegations = [
  '検証レポートが矛盾と判定されていません',
  '検証レポートは自己矛盾とは言えません',
  '検証レポートが矛盾と判定されていませんでした',
  '検証レポートは自己矛盾とは言えませんでした',
];

beforeEach(() => {
  submitConcernMock.mockClear();
  submitConcernMock.mockImplementation(async () => ({ outcome: 'created' }));
});

describe('classifyBounceReason', () => {
  it.each(
    politeNegations.flatMap((text) => [
      { input: { reason: text, detail: '' }, expected: 'other' },
      { input: { reason: '', detail: text }, expected: 'other' },
    ]),
  )('丁寧な否定を理由・本文のどちらでも除外する: %j', ({ input, expected }) => {
    expect(classifyBounceReason(input)).toBe(expected);
    expect(extractContradictionSentences(input.reason, input.detail)).toEqual([]);
  });

  it.each(['検証レポートが矛盾と判定されています', '検証レポートは自己矛盾と言えます'])(
    '対応する丁寧な肯定文は対象に残す: %s',
    (reason) => {
      expect(classifyBounceReason({ reason })).toBe('verify_contradiction');
    },
  );

  it.each(pastNegations)('過去形の否定は矛盾判定に含めない: %s', (text) => {
    expect(classifyBounceReason(text)).toBe('other');
  });

  it('過去の肯定的な自己矛盾判定は対象に残す', () => {
    expect(classifyBounceReason('検証レポートは自己矛盾していたと判定された')).toBe(
      'verify_contradiction',
    );
  });

  it('classifies the 2026-11-24 real examples', () => {
    expect(classifyBounceReason('差分レビュー不合格: 計画外のファイルを変更している')).toBe(
      'diff_review',
    );
    expect(classifyBounceReason('verify.md self-contradicts the measured gate result')).toBe(
      'verify_contradiction',
    );
    expect(classifyBounceReason('ERR_PNPM_OUTDATED_LOCKFILE Cannot install')).toBe('environment');
    expect(classifyBounceReason('ポート 3001 は使用中のため起動できない')).toBe('environment');
    expect(classifyBounceReason('計画項目の未実施: テストが追加されていない')).toBe('plan_gap');
  });

  it('classifies implementation gaps', () => {
    expect(classifyBounceReason('verify.md explicitly marks a failing implementation')).toBe(
      'implementation_gap',
    );
  });

  it('puts unknown, empty and null input into other', () => {
    expect(classifyBounceReason('よくわからない理由')).toBe('other');
    expect(classifyBounceReason('')).toBe('other');
    expect(classifyBounceReason(null)).toBe('other');
    expect(classifyBounceReason(undefined)).toBe('other');
  });

  it('falls back to detail text when the reason is empty', () => {
    expect(classifyBounceReason({ reason: '', detail: 'ERR_PNPM_FETCH_404 ...' })).toBe(
      'environment',
    );
  });

  it('uses kind priority across reason and detail', () => {
    expect(
      classifyBounceReason({ reason: '差分レビュー不合格', detail: 'ECONNREFUSED in a log' }),
    ).toBe('diff_review');
  });

  it.each([
    'verify.md self-contradicts',
    'self_contradiction',
    '検証レポートが自己矛盾していると判定',
    'verify.md が矛盾している',
    '検証結果が矛盾と判定された',
    '検証レポートの内容が矛盾しています',
    '検証結果は自己矛盾している',
  ])('矛盾判定の正例: %s', (text) => {
    expect(classifyBounceReason(text)).toBe('verify_contradiction');
  });

  it.each([
    ['検証結果に矛盾はない', 'other'],
    ['verify.md に矛盾なし', 'other'],
    ['検証レポートは矛盾していない', 'other'],
    ['設計に矛盾がある', 'plan_gap'],
    ['計画と実装が矛盾', 'plan_gap'],
    ['仕様の矛盾', 'other'],
    ['検証結果では設計と実装が矛盾している', 'plan_gap'],
    ['検証レポートに自己矛盾はありません', 'other'],
    ['verify.md では計画と実装が自己矛盾している', 'plan_gap'],
    ['検証結果によると仕様が矛盾している', 'other'],
    ['検証レポートは自己矛盾していません', 'other'],
    ['検証結果は自己矛盾ではありません', 'other'],
    ['検証レポートが矛盾していると判定されたが、矛盾は見当たりません', 'other'],
    ['検証結果が矛盾していますが、自己矛盾はありません', 'other'],
  ])('矛盾判定の負例: %s -> %s', (text, kind) => {
    expect(classifyBounceReason(text)).toBe(kind);
  });

  it.each([
    ['自動検証に失敗しました（test=NG）', 'ERR_PNPM_FETCH_404', 'environment'],
    ['実装の不足', 'ポート3001は使用中', 'environment'],
    ['差分レビュー不合格', 'self-contradicts', 'verify_contradiction'],
    ['未達', '計画項目の未実施', 'plan_gap'],
    ['plan 項目の未実施', '', 'plan_gap'],
    ['port localhost:3001 in use', '', 'environment'],
  ])('理由と本文の種類優先順: %s / %s', (reason, detail, expected) => {
    expect(classifyBounceReason({ reason, detail })).toBe(expected);
  });

  it('機械語彙は否定文が併記されても矛盾判定を維持する', () => {
    expect(
      classifyBounceReason({
        reason: 'SELF_CONTRADICTION',
        detail: '検証レポートに自己矛盾はありません',
      }),
    ).toBe('verify_contradiction');
  });
});

describe('pattern normalization', () => {
  it('merges sentences that differ only by numbers, ids and paths', () => {
    const a = 'verify.md self-contradicts: task #12 port 3001 at C:\\a\\b.ts';
    const b = 'verify.md self-contradicts: task #99 port 4000 at /x/y/z.ts';
    expect(normalizeBouncePattern(a)).toBe(normalizeBouncePattern(b));
    expect(bouncePatternId(a)).toBe(bouncePatternId(b));
  });

  it('keeps different sentences apart', () => {
    expect(bouncePatternId('self-contradicts A')).not.toBe(bouncePatternId('self-contradicts B'));
  });

  it('数字・パス・ID・ハッシュ・空白を除去して160文字に制限する', () => {
    expect(
      normalizeBouncePattern('SELF-contradicts #1541 C:\\work\\test.ts abcdef123456 3001\n X'),
    ).toBe('self-contradictsx');
    expect(normalizeBouncePattern('A'.repeat(161))).toBe('a'.repeat(160));
  });
});

describe('summarizeBounces', () => {
  it('counts all kinds including other, and ranks tasks deterministically', () => {
    const items = [
      toBounceItem(JSON.stringify({ reason: '差分レビュー不合格' }), 7),
      toBounceItem(JSON.stringify({ reason: '差分レビュー不合格' }), 3),
      toBounceItem(JSON.stringify({ reason: 'ERR_PNPM x' }), 3),
      toBounceItem(JSON.stringify({ failedChecks: ['EADDRINUSE'] }), 9),
      toBounceItem('{broken', 9),
      toBounceItem(null, null),
    ];
    const s = summarizeBounces(items);
    expect(s.bounceKinds.diff_review).toBe(2);
    expect(s.bounceKinds.environment).toBe(2);
    expect(s.bounceKinds.other).toBe(2);
    expect(Object.values(s.bounceKinds).reduce((a, b) => a + b, 0)).toBe(items.length);
    expect(s.topBounceTasks).toEqual([
      { taskId: 3, count: 2 },
      { taskId: 9, count: 2 },
      { taskId: 7, count: 1 },
    ]);
  });

  it('groups contradiction patterns', () => {
    const mk = (n: number) =>
      toBounceItem(JSON.stringify({ reason: `verify.md self-contradicts run ${n}` }), n);
    const s = summarizeBounces([mk(1), mk(2), mk(3)]);
    expect(s.contradictionPatterns).toHaveLength(1);
    expect(s.contradictionPatterns[0]!.count).toBe(3);
  });

  it('本文だけの矛盾判定も同一パターンとして集計する', () => {
    const items = [1, 2, 3].map((taskId) =>
      toBounceItem(JSON.stringify({ verifyContent: `self-contradicts task #${taskId}` }), taskId),
    );
    const result = summarizeBounces(items);
    expect(result.bounceKinds.verify_contradiction).toBe(3);
    expect(result.contradictionPatterns).toHaveLength(1);
    expect(result.contradictionPatterns[0]!.count).toBe(3);
  });

  it('汎用理由が同じでも異なる本文の矛盾は別パターンにする', () => {
    const items = ['環境拒否', '測定結果'].map((text) =>
      toBounceItem(JSON.stringify({ reason: '未達', verifyContent: `self-contradicts: ${text}` })),
    );
    expect(summarizeBounces(items).contradictionPatterns).toHaveLength(2);
  });

  it('週3回の候補が21種類あっても全件を起票へ渡す', async () => {
    const items = Array.from({ length: 21 }, (_, i) =>
      Array.from({ length: 3 }, () =>
        toBounceItem(
          JSON.stringify({ reason: `self-contradicts: pattern ${String.fromCharCode(65 + i)}` }),
        ),
      ),
    ).flat();
    const result = summarizeBounces(items);
    expect(result.contradictionPatterns).toHaveLength(21);
    expect(await fileGateMisjudgmentCandidates(result.contradictionPatterns)).toBe(21);
    expect(submitConcernMock).toHaveBeenCalledTimes(21);
  });

  it('上位5タスクだけを件数順・ID順に並べる', () => {
    const items = [7, 6, 5, 4, 3, 2, 1, 7].map((id) => toBounceItem(null, id));
    expect(summarizeBounces(items).topBounceTasks).toEqual([
      { taskId: 7, count: 2 },
      { taskId: 1, count: 1 },
      { taskId: 2, count: 1 },
      { taskId: 3, count: 1 },
      { taskId: 4, count: 1 },
    ]);
  });

  it('renders text and tolerates missing breakdown', () => {
    expect(formatBounceBreakdown(undefined)).toBe('');
    const text = formatBounceBreakdown(summarizeBounces([toBounceItem('{}', 5)]));
    expect(text).toContain('その他 1 件');
    expect(text).toContain('#5(1回)');
  });
});

describe('negated and design contradictions never reach the filer', () => {
  it.each(
    politeNegations.flatMap((text) =>
      (['reason', 'verifyContent'] as const).map((field) => ({ text, field })),
    ),
  )('丁寧な否定が週3回あっても起票しない: %j', async ({ text, field }) => {
    const items = [1, 2, 3].map((taskId) =>
      toBounceItem(JSON.stringify({ [field]: text }), taskId),
    );
    const summary = summarizeBounces(items);
    expect(summary.bounceKinds.other).toBe(3);
    expect(summary.contradictionPatterns).toEqual([]);
    expect(await fileGateMisjudgmentCandidates(summary.contradictionPatterns)).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  it.each(pastNegations)('過去形の否定が週3回あっても起票しない: %s', async (text) => {
    for (const field of ['reason', 'verifyContent'] as const) {
      const items = [1, 2, 3].map((taskId) =>
        toBounceItem(JSON.stringify({ [field]: text }), taskId),
      );
      const summary = summarizeBounces(items);
      expect(summary.bounceKinds.other).toBe(3);
      expect(summary.contradictionPatterns).toEqual([]);
      expect(await fileGateMisjudgmentCandidates(summary.contradictionPatterns)).toBe(0);
      expect(submitConcernMock).not.toHaveBeenCalled();
    }
  });

  it.each(['検証結果に矛盾はない', '設計に矛盾がある', '計画と実装が矛盾'])(
    '3 occurrences of %s file nothing',
    async (reason) => {
      const items = [1, 2, 3].map((n) => toBounceItem(JSON.stringify({ reason }), n));
      const summary = summarizeBounces(items);
      expect(summary.bounceKinds.verify_contradiction).toBe(0);
      expect(await fileGateMisjudgmentCandidates(summary.contradictionPatterns)).toBe(0);
      expect(submitConcernMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['検証結果では設計と実装が矛盾している', 'plan_gap'],
    ['検証レポートに自己矛盾はありません', 'other'],
    ['verify.md では計画と実装が自己矛盾している', 'plan_gap'],
    ['検証結果によると仕様が矛盾している', 'other'],
    ['検証レポートは自己矛盾していません', 'other'],
    ['検証結果は自己矛盾ではありません', 'other'],
    ['検証結果が矛盾していますが、自己矛盾はありません', 'other'],
  ] as const)('本文の対象外文が3回あっても起票しない: %s', async (verifyContent, kind) => {
    const items = [1, 2, 3].map((taskId) =>
      toBounceItem(JSON.stringify({ verifyContent }), taskId),
    );
    expect(classifyBounceReason(verifyContent)).toBe(kind);
    const summary = summarizeBounces(items);
    expect(summary.bounceKinds[kind]).toBe(3);
    expect(summary.contradictionPatterns).toEqual([]);
    expect(await fileGateMisjudgmentCandidates(summary.contradictionPatterns)).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });
});

describe('fileGateMisjudgmentCandidates', () => {
  const pat = (count: number) => [{ patternId: 'abcd1234', count, sample: 'self-contradicts' }];

  it('does not file below the threshold', async () => {
    expect(await fileGateMisjudgmentCandidates(pat(2))).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  it('files once at 3 with a per-pattern dedupKey', async () => {
    expect(await fileGateMisjudgmentCandidates(pat(3))).toBe(1);
    const arg = submitConcernMock.mock.calls[0]![0] as { dedupKey: string };
    expect(arg.dedupKey).toBe('loop-review:gate-misjudgment:abcd1234');
  });

  it('does not count a reused concern (no duplicate on rerun)', async () => {
    submitConcernMock.mockImplementation(async () => ({ outcome: 'reused' }));
    expect(await fileGateMisjudgmentCandidates(pat(5))).toBe(0);
  });

  it('survives a failing submit and handles undefined', async () => {
    submitConcernMock.mockImplementation(async () => {
      throw new Error('db');
    });
    expect(await fileGateMisjudgmentCandidates(pat(4))).toBe(0);
    expect(await fileGateMisjudgmentCandidates(undefined)).toBe(0);
  });

  it('候補の起票失敗後も残りを起票する', async () => {
    submitConcernMock.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    expect(
      await fileGateMisjudgmentCandidates([
        ...pat(3),
        { patternId: 'second', count: 3, sample: 'self-contradicts another result' },
      ]),
    ).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(2);
  });
});

describe('sentence-level contradiction judgment', () => {
  it.each(politeNegations)('丁寧な否定は別文の肯定判定とパターンを変えない: %s', async (text) => {
    const affirmative = '検証レポートが矛盾と判定された';
    const items = [
      { reason: `${text}。${affirmative}。` },
      { reason: `${affirmative}。${text}。` },
      { reason: text, verifyContent: affirmative },
    ].map((metadata, index) => toBounceItem(JSON.stringify(metadata), index + 1));
    const summary = summarizeBounces(items);
    expect(summary.bounceKinds.verify_contradiction).toBe(3);
    expect(summary.contradictionPatterns).toEqual([
      { patternId: bouncePatternId(affirmative), count: 3, sample: affirmative },
    ]);
    expect(await fileGateMisjudgmentCandidates(summary.contradictionPatterns)).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
  });

  it.each(['。', '．', '. ', '!', '?', '！', '？', '\n'])(
    '区切り文字で否定文と肯定文を分離する: %j',
    (separator) => {
      const negative = politeNegations[0]!;
      const affirmative = '検証レポートが矛盾と判定された';
      expect(splitSentences(`${negative}${separator}${affirmative}`)).toEqual([
        negative,
        affirmative,
      ]);
      expect(extractContradictionSentences(`${negative}${separator}${affirmative}`, '')).toEqual([
        affirmative,
      ]);
    },
  );

  it.each([
    ['検証レポートが矛盾しています', '', 'verify_contradiction'],
    ['検証結果に矛盾はない。検証レポートが矛盾と判定された。', '', 'verify_contradiction'],
    ['検証レポートが矛盾と判定された。ただし設計に矛盾はない。', '', 'verify_contradiction'],
    ['検証結果に矛盾はない', '検証レポートが自己矛盾していると判定', 'verify_contradiction'],
  ])('reason=%s detail=%s -> %s', (reason, detail, expected) => {
    expect(classifyBounceReason({ reason, detail })).toBe(expected);
  });

  it('splits sentences without breaking verify.md', () => {
    expect(splitSentences('verify.md が矛盾している。次の文. 三つ目\n四つ目')).toEqual([
      'verify.md が矛盾している',
      '次の文',
      '三つ目',
      '四つ目',
    ]);
    expect(splitSentences(null)).toEqual([]);
  });
});

describe('否定の位置判定（NEGATION_TAIL）', () => {
  it.each([
    '検証レポートが矛盾していない',
    '検証レポートが矛盾していなかった',
    '検証レポートが矛盾していません',
    '検証レポートが矛盾していませんでした',
    '検証レポートは矛盾しておりません',
    '検証レポートは矛盾しておりませんでした',
    '検証レポートに矛盾はございません',
    '検証レポートに矛盾はございませんでした',
    '検証レポートに矛盾はない',
    '検証レポートに矛盾はなかった',
    '検証レポートに矛盾なし',
    '検証レポートが矛盾しているとは言えない',
    '検証レポートが矛盾しているわけではありません',
    '検証レポートは矛盾とは判定していません',
    '検証レポートが矛盾と判定されていません',
    '検証レポートは自己矛盾とは言えません',
  ])('否定は verify_contradiction にしない: %s', (text) => {
    expect(classifyBounceReason({ reason: text, detail: '' })).not.toBe('verify_contradiction');
    expect(extractContradictionSentences(text, '')).toEqual([]);
  });

  it.each([
    '検証レポートが矛盾している',
    '検証レポートが矛盾しています',
    '検証レポートに自己矛盾がある',
    'verify.md は自己矛盾',
    'verify.md self-contradicts',
    'self_contradiction',
  ])('肯定は verify_contradiction: %s', (text) => {
    expect(classifyBounceReason({ reason: text, detail: '' })).toBe('verify_contradiction');
  });

  describe('意図した取りこぼし', () => {
    // 別の否定語尾が混ざる肯定文は誤起票より取りこぼしを選ぶ（plan.md §NEGATION_TAIL）。
    it('矛盾しているため直せない は対象外', () => {
      expect(classifyBounceReason({ reason: '検証レポートが矛盾しているため直せない' })).not.toBe(
        'verify_contradiction',
      );
    });
  });
});

describe('verify report を主語とする正例と、設計矛盾の区別', () => {
  it.each([
    'verify report self-contradicts',
    'verify report is self-contradictory',
    'verify report が矛盾している',
    'verify report は矛盾と判定された',
  ])('verify report の肯定は verify_contradiction: %s', (text) => {
    expect(classifyBounceReason({ reason: text, detail: '' })).toBe('verify_contradiction');
  });

  it('verify report の否定は対象外', () => {
    expect(classifyBounceReason({ reason: 'verify report does not self-contradict' })).not.toBe(
      'verify_contradiction',
    );
    expect(classifyBounceReason({ reason: 'verify report に矛盾はない' })).not.toBe(
      'verify_contradiction',
    );
  });

  it('レポートが言及する設計の矛盾は plan_gap のまま', () => {
    expect(classifyBounceReason({ reason: '検証結果では設計と実装が矛盾している' })).toBe(
      'plan_gap',
    );
    expect(classifyBounceReason({ reason: 'verify report では計画と実装が矛盾している' })).toBe(
      'plan_gap',
    );
  });
});
