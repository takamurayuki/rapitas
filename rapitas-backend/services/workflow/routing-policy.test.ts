/**
 * routing-policy テスト
 *
 * ロール下限・リスクオーバーライド・失敗エスカレーションのティア決定を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  highestTier,
  isCapabilityRole,
  computeMinTier,
  computeMinTierWithReason,
  isCapabilityAttributableFailure,
} from './routing-policy';

describe('highestTier', () => {
  test('最も能力の高いティアを返す', () => {
    expect(highestTier('economy', 'premium', 'standard')).toBe('premium');
    expect(highestTier('free', 'economy')).toBe('economy');
  });
  test('undefined は無視し、全て未指定なら undefined', () => {
    expect(highestTier(undefined, 'standard', undefined)).toBe('standard');
    expect(highestTier(undefined, undefined)).toBeUndefined();
  });
});

describe('isCapabilityRole', () => {
  test('実装/計画/検証は capability ロール', () => {
    // NOTE: planner added — a defective plan is the most expensive failure
    // mode (all implementation follows it), so it gets the standard floor too.
    for (const r of ['implementer', 'planner', 'verifier', 'auto_verifier']) {
      expect(isCapabilityRole(r)).toBe(true);
    }
  });
  test('退役した reviewer ロールは capability ロールではない', () => {
    expect(isCapabilityRole('reviewer')).toBe(false);
  });
  test('調査は capability ロールではない', () => {
    expect(isCapabilityRole('researcher')).toBe(false);
  });
});

describe('computeMinTier', () => {
  test('capability ロールは既定で standard 下限', () => {
    expect(computeMinTier({ role: 'implementer', taskRetries: 0, riskHigh: false })).toBe(
      'standard',
    );
  });
  test('調査は下限なし', () => {
    expect(computeMinTier({ role: 'researcher', taskRetries: 0, riskHigh: false })).toBeUndefined();
  });
  test('タスク自身のリトライ(>=1)は premium に引き上げ（ハードシグナル）', () => {
    expect(computeMinTier({ role: 'researcher', taskRetries: 1, riskHigh: false })).toBe('premium');
    expect(computeMinTier({ role: 'implementer', taskRetries: 2, riskHigh: false })).toBe(
      'premium',
    );
  });
  test('テーマエスカレーションはソフト: レベル1も2も standard 止まり（premium にしない）', () => {
    // Routine self-repair churn saturates this rate — measured 2026-08-18,
    // 6/10 recent tasks carried a verify_repair transition, so level 2 was
    // permanently in effect and pinned every phase of every task to premium
    // (16/18 routing decisions → claude-fable-5, incl. complexity 5 and 22).
    // A theme-wide average must never justify premium for one cheap phase.
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 0, themeEscalation: 1, riskHigh: false }),
    ).toBe('standard');
    expect(
      computeMinTier({ role: 'implementer', taskRetries: 0, themeEscalation: 1, riskHigh: false }),
    ).toBe('standard');
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 0, themeEscalation: 2, riskHigh: false }),
    ).toBe('standard');
    expect(
      computeMinTier({ role: 'implementer', taskRetries: 0, themeEscalation: 2, riskHigh: false }),
    ).toBe('standard');
  });
  test('テーマレベル2でも、実際に失敗したタスクは premium へ上がる', () => {
    // The theme cap applies to the THEME signal only — a retry still escalates.
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 1, themeEscalation: 2, riskHigh: false }),
    ).toBe('premium');
  });

  // NOTE: 2026-08-25. The risk floor used to pay premium on the FIRST attempt,
  // i.e. on a prediction. Failure is cheap here — the verify gate, the
  // adversarial review and self-repair all run before anything merges — while
  // premium is not: measured over 14 days, standard completed 99.3% of
  // executions at a fifth of premium's cost and showed no fewer verify-repair
  // rounds. So risk now raises the FIRST attempt to standard and reaches
  // premium only once an attempt has actually failed.
  describe('高リスクの床は反応型', () => {
    test('初回は standard 止まり（予測では premium を買わない）', () => {
      expect(computeMinTier({ role: 'planner', taskRetries: 0, riskHigh: true })).toBe('standard');
      // Even a role with no floor of its own is lifted to standard by risk.
      expect(computeMinTier({ role: 'researcher', taskRetries: 0, riskHigh: true })).toBe(
        'standard',
      );
    });

    test('実際に失敗した後は premium へ上がる', () => {
      expect(
        computeMinTier({
          role: 'researcher',
          taskRetries: 1,
          riskHigh: true,
          retryCause: 'diff was rejected by the adversarial review',
        }),
      ).toBe('premium');
    });

    test('インフラ起因の失敗でも、高リスクなら再試行は premium へ上がる', () => {
      // The retry floor alone would decline this cause (a spend limit says
      // nothing about capability), but risk makes the SECOND attempt worth the
      // strongest model regardless of why the first one died.
      expect(
        computeMinTier({
          role: 'planner',
          taskRetries: 1,
          riskHigh: true,
          retryCause: "you've hit your usage limit",
        }),
      ).toBe('premium');
    });
  });

  describe('premium 昇格は実績で正当化される必要がある', () => {
    test('premium に standard を上回る実績が無ければ standard に抑制', () => {
      const r = computeMinTierWithReason({
        role: 'implementer',
        taskRetries: 1,
        riskHigh: false,
        retryCause: 'diff rejected',
        premiumJustified: false,
      });
      expect(r.tier).toBe('standard');
      expect(r.reason).toContain('premium実績なし');
    });

    test('実績があれば premium のまま', () => {
      expect(
        computeMinTier({
          role: 'implementer',
          taskRetries: 1,
          riskHigh: false,
          retryCause: 'diff rejected',
          premiumJustified: true,
        }),
      ).toBe('premium');
    });

    test('証拠不足(undefined)は現状維持', () => {
      expect(
        computeMinTier({
          role: 'implementer',
          taskRetries: 1,
          riskHigh: false,
          retryCause: 'diff rejected',
        }),
      ).toBe('premium');
    });
  });
  test('実証済みティアは capability ロールの床を緩和する', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBe('economy');
  });
  test('実証済みティアが床より強い場合は緩和しない（床は下がるだけ）', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: false,
        provenTier: 'premium',
      }),
    ).toBe('standard');
  });
  test('高リスク/タスクリトライ時は実証済みティアが床を下げられない', () => {
    // The floor still wins over evidence — what changed is WHERE the risk floor
    // sits on a first attempt (standard, not premium). A proven economy tier
    // must not drag it below that.
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: true,
        provenTier: 'economy',
      }),
    ).toBe('standard');
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 1,
        riskHigh: true,
        provenTier: 'economy',
        retryCause: 'diff rejected',
      }),
    ).toBe('premium');
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 1,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBe('premium');
  });
  test('テーマレベル1では実証済みティアが standard 床まで下げられる（実績収集が凍結しない）', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        themeEscalation: 1,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBe('standard');
  });
  test('非 capability ロールは provenTier があっても床なしのまま', () => {
    expect(
      computeMinTier({
        role: 'researcher',
        taskRetries: 0,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBeUndefined();
  });
});

describe('isCapabilityAttributableFailure', () => {
  test('プロバイダ枠・停止・状態エラーはモデル起因ではない', () => {
    const infra = [
      "You've hit your monthly spend limit. claude.ai/settings/usage",
      'Max retries (3) exceeded — last error: ステータス "awaiting_question" では次のフェーズを実行できません',
      'Max retries (3) exceeded — last error: タスクはブロック中のため自動実行をスキップしました',
      'Phase execution timeout for task 600 (30 minutes)',
      'Auto-run stopped',
      'Cancelled by user',
      'Anthropic API error: overloaded',
      'Process exited with code 1\n[System: init] API Error: 500 Internal server error.',
      'API Error: 503 Service Unavailable',
    ];
    for (const cause of infra) {
      expect(isCapabilityAttributableFailure(cause)).toBe(false);
    }
  });

  test('成果物の品質・欠落はモデル起因として扱う', () => {
    expect(
      isCapabilityAttributableFailure(
        'Agent output a plan but no actual code changes were made. Please review the prompt and re-execute.',
      ),
    ).toBe(true);
    expect(
      isCapabilityAttributableFailure(
        'verify.md was saved, but the task did not pass the completion gate.',
      ),
    ).toBe(true);
  });

  test('理由が未記録なら従来どおりエスカレーションする', () => {
    expect(isCapabilityAttributableFailure(null)).toBe(true);
    expect(isCapabilityAttributableFailure('')).toBe(true);
    expect(isCapabilityAttributableFailure(undefined)).toBe(true);
  });
});

describe('computeMinTier — 再試行原因によるエスカレーション制御', () => {
  const base = { role: 'implementer', taskRetries: 1, riskHigh: false } as const;

  test('インフラ起因の再試行では premium に上げない', () => {
    expect(
      computeMinTier({
        ...base,
        retryCause: "You've hit your monthly spend limit. claude.ai/settings/usage",
      }),
    ).toBe('standard');
  });

  test('モデル起因の再試行では従来どおり premium に上げる', () => {
    expect(
      computeMinTier({
        ...base,
        retryCause: 'Agent output a plan but no actual code changes were made.',
      }),
    ).toBe('premium');
  });

  test('原因未記録の再試行は premium のまま（後方互換）', () => {
    expect(computeMinTier(base)).toBe('premium');
  });

  test('インフラ起因でも高リスクなら premium は維持される', () => {
    expect(
      computeMinTier({
        ...base,
        riskHigh: true,
        retryCause: 'Phase execution timeout for task 600 (30 minutes)',
      }),
    ).toBe('premium');
  });
});

describe('computeMinTierWithReason', () => {
  test('下限を決めた規則を返す', () => {
    expect(
      computeMinTierWithReason({ role: 'researcher', taskRetries: 0, riskHigh: true }).reason,
    ).toContain('高リスク');
    expect(
      computeMinTierWithReason({ role: 'implementer', taskRetries: 0, riskHigh: false }).reason,
    ).toContain('ロール下限');
    expect(
      computeMinTierWithReason({
        role: 'implementer',
        taskRetries: 1,
        riskHigh: false,
        retryCause: 'no code changes were made',
      }).reason,
    ).toContain('再試行');
  });

  test('下限なしなら理由も返さない', () => {
    const r = computeMinTierWithReason({ role: 'researcher', taskRetries: 0, riskHigh: false });
    expect(r.tier).toBeUndefined();
    expect(r.reason).toBeUndefined();
  });
});
