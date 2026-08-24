/**
 * routing-policy テスト
 *
 * ロール下限・リスクオーバーライド・失敗エスカレーションのティア決定を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  highestTier,
  isCapabilityRole,
  detectHighRisk,
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

describe('detectHighRisk', () => {
  test('スキーマ/認証/決済/セキュリティ語を含むと高リスク', () => {
    expect(detectHighRisk({ text: 'prisma schema を変更' }).high).toBe(true);
    expect(detectHighRisk({ text: '認証フローの修正' }).high).toBe(true);
    expect(detectHighRisk({ text: 'add payment webhook' }).high).toBe(true);
  });
  test('plan の危険なファイルパスでも高リスク', () => {
    expect(
      detectHighRisk({ text: 'tweak', planContent: '- `prisma/schema/core.prisma`' }).high,
    ).toBe(true);
  });
  test('無害なテキストは低リスク', () => {
    expect(
      detectHighRisk({ text: 'ボタンの色を変更', planContent: '- `src/Button.tsx`' }).high,
    ).toBe(false);
  });
});

// NOTE: 負例3件は 2026-08-17 に rapitas-dev.db から取得した実 title+description。
// いずれも旧 HIGH_RISK_RE では premium 誤爆していた(534=暗号 単独、536/538=
// 「Prisma スキーマ変更禁止」定型文の prisma)。要約や言い換えではなく実文字列を
// 使うこと — 推測文字列では実発火率の回帰を検出できない。
describe('detectHighRisk 誤爆解消(実タスク負例)', () => {
  // NOTE: 534 は DB 実データそのもの — Task.title が丸ごとこの書名
  // (実在書籍。副題「秘密の国のアリス」まで含めて DB の title 列の全文)で、
  // Task.description は NULL。作為的な文字列ではない。
  test('534: 読書タスク「暗号化技術入門」は低リスク(暗号 単独・crypto 文脈なし)', () => {
    expect(detectHighRisk({ text: '暗号化技術入門 第３版 秘密の国のアリス' }).high).toBe(false);
  });
  test('536: スキーマ変更禁止の定型文を含む通知タスクは低リスク', () => {
    const text =
      'バックログジョブ「今すぐ実行」の完了と結果件数を通知で観測可能にする\n' +
      '## 背景\nPOST /backlog/schedules/:kind/run-now は fire-and-forget で {started:true} のみを返すため、ジョブ(innovation / vuln_scan / health_check / loop_review / ci_watch)が『静かに成功して0件だった』のか『実行されなかった/失敗した』のかを UI からもログ(warn以上のみファイル出力)からも区別できない。\n\n' +
      '## 要求\nrunBacklogJobNow で開始された手動実行が完了したとき、結果を Notification として記録する(スキーマ変更は不可、既存の Notification テーブルを使う)。\n\n' +
      '## 受入基準\n1. run-now で開始したジョブの完了時に、ジョブ種別名と生成件数を含む Notification が作成される(例: 「CI 監視(本線)が完了しました: 起票 0 件」)。失敗時はエラー概要を含む Notification が作成される。\n2. スケジューラの定期起動経路の挙動は変更しない(通知は run-now 経由のみ。定期実行まで通知すると毎日ノイズになる)。\n3. run-now 経由の実行でも BacklogSchedule.lastRunAt が更新される(定期起動との二重実行を同日ガードで防ぐ効果もある)。\n4. 追加・変更したロジックにユニットテストを追加する(bun test はファイル単位で実行)。\n\n' +
      '## 制約\n- Prisma スキーマ変更禁止(再起動を要するため)。\n- 対象は rapitas-backend のみ(フロントエンド変更は不要。通知は既存の通知ベルに自然に表示される)。\n- 変更対象の中心: services/scheduling/backlog-scheduler.ts(runBacklogJobNow)。routes/backlog/schedule-routes.ts は必要な場合のみ最小変更。';
    expect(detectHighRisk({ text }).high).toBe(false);
  });
  test('538: 批評ゲート履歴表示タスク(スキーマ変更禁止の定型文入り)は低リスク', () => {
    const text =
      'タスク詳細のワークフロー履歴に批評ゲートの差し戻し理由を表示する\n' +
      '## 背景\nresearch/plan の品質批評ゲートは差し戻し理由を WorkflowTransition の metadata (severity, reasons[]) に記録しており、GET /workflow/tasks/:taskId/transitions で取得できる。しかし UI にはこの情報が出ないため、ユーザーは『なぜ調査/計画が差し戻されたのか』をログや API を直接叩かないと確認できない。品質ループの動きを利用者に見える化したい。\n\n' +
      '## 要求\nタスク詳細ページのワークフローセクション(TaskWorkflowSection 周辺)に、批評ゲート関連の遷移(cause が research_critic_failed / plan_critic_failed / research_critic_exhausted / plan_critic_exhausted)を時系列で表示し、各項目を展開すると reasons の一覧が読めるようにする。\n\n' +
      '## 受入基準\n1. 該当タスクに批評遷移が存在する場合のみ、ワークフローセクション内に『品質ゲートの指摘履歴』の表示領域が現れる(存在しなければ何も表示しない)。\n2. 各エントリに: 発生時刻・フェーズ(research/plan)・種別(差し戻し/予算切れ素通し)・severity を表示。\n3. エントリは折りたたみ式で、展開すると metadata.reasons の各指摘が箇条書きで読める(長文はそのまま表示してよい)。\n4. データ取得は既存の GET /workflow/tasks/:taskId/transitions を利用する(バックエンド変更が不要ならしない。必要なら最小限)。\n5. 表示文言は i18n (ja/en) 対応。\n6. 追加・変更ロジックにユニットテストを追加する(表示条件の分岐と、遷移データ→表示モデルへの変換ロジックを最低限カバー)。\n\n' +
      '## 制約\n- Prisma スキーマ変更禁止。\n- 既存の TaskWorkflowSection のデザイン言語(カード・見出し・折りたたみの既存パターン)を踏襲し、新規の独自UIパターンを作らない。\n- アイコンを追加する場合は .claude/ICON_POLICY.md に従う(テキストのみでも可)。\n- ポーリングの新設はしない(既存のデータ取得タイミングに乗せるか、セクション展開時に1回取得する)。\n\n' +
      '## 仕様補足（ユーザー回答）\n**A: plan.md の変更予定ファイルに `.github/workflows/pr-preview.yml` を追記し、本PRで CI 修正を承認する（推奨）**';
    expect(detectHighRisk({ text }).high).toBe(false);
  });
});

describe('detectHighRisk 正例(本物の高リスクは発火維持)', () => {
  test.each([
    ['prisma/schema/core.prisma にカラム追加'],
    ['migration を追加してテーブルを分割'],
    ['認証フローの不具合を修正'],
    ['password reset を実装'],
    ['決済 webhook のリトライ処理'],
    ['RBAC 権限モデルにロール追加'],
    ['XSS 脆弱性を修正'],
    ['暗号鍵のローテーションを実装'],
  ])('%s → 高リスク', (text) => {
    expect(detectHighRisk({ text }).high).toBe(true);
  });
});

describe('detectHighRisk 境界(文脈ゲートと禁止文サニタイズ)', () => {
  test('セキュリティの言及のみ(脆弱性/修正文脈なし)は低リスク', () => {
    expect(detectHighRisk({ text: 'セキュリティ上の懸念はない' }).high).toBe(false);
  });
  test('セキュリティ+脆弱性文脈は高リスク', () => {
    expect(detectHighRisk({ text: 'セキュリティ脆弱性の調査' }).high).toBe(true);
  });
  test('権限 単独(auth 文脈なし)は低リスク、認可/アクセス制御と共起で高リスク', () => {
    expect(detectHighRisk({ text: '表示権限の説明文を追記' }).high).toBe(false);
    expect(detectHighRisk({ text: 'アクセス制御の権限チェックを追加' }).high).toBe(true);
  });
  test('暗号 単独は低リスク、鍵と共起で高リスク', () => {
    expect(detectHighRisk({ text: '暗号についての解説ページ' }).high).toBe(false);
    expect(detectHighRisk({ text: '暗号鍵の保管方法を変える' }).high).toBe(true);
  });
  test('LLM トークン文脈(MAX_TOKENS / tokens used)は発火しない', () => {
    expect(detectHighRisk({ text: 'MAX_TOKENS を 8192 に調整' }).high).toBe(false);
    expect(detectHighRisk({ text: 'tokens used をダッシュボードに表示' }).high).toBe(false);
  });
  test('禁止文サニタイズ: スキーマ変更禁止の文だけなら発火せず、実変更の文が残れば発火', () => {
    expect(detectHighRisk({ text: 'Prisma スキーマ変更禁止。通知テーブルを使う' }).high).toBe(
      false,
    );
    expect(detectHighRisk({ text: 'migration を追加する。既存スキーマの変更は禁止' }).high).toBe(
      true,
    );
  });
  test('plan 本文にも同じゲートが効く(禁止文の prisma では発火しない)', () => {
    expect(
      detectHighRisk({ text: 'tweak', planContent: '制約: Prisma スキーマ変更禁止。' }).high,
    ).toBe(false);
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

describe('detectHighRisk — データ層シグナルは構造的なものだけ', () => {
  test('回帰: import 文を引用しただけの plan を高リスクにしない', () => {
    // 実測 2026-08-24 task 627（ファイル分割リファクタ）: plan が移設対象の
    // import 行 `import { prisma } from '../../config';` を引用していたため
    // premium 下限が課され、機械的な分割作業が最上位モデルで走った。
    const plan = [
      '## 実装計画',
      '- 内容: 61-78行の `resolveSystemPromptContent` を verbatim 移設。',
      "  `import { prisma } from '../../config';` も併せて移動する。",
    ].join('\\n');
    expect(detectHighRisk({ text: 'ファイル分割', planContent: plan }).high).toBe(false);
  });

  test('スキーマファイル・マイグレーション・DSL は引き続き高リスク', () => {
    const cases = [
      'prisma/schema/core.prisma に列を追加する',
      'schema.prisma を編集する',
      'prisma/migrations/ に新しいマイグレーションを追加',
      'model Task {',
      '`prisma db push` を実行して反映する',
      '@@unique([taskId, orchestraSessionId]) を追加',
    ];
    for (const plan of cases) {
      expect(detectHighRisk({ text: '', planContent: plan }).high).toBe(true);
    }
  });

  test('ORM を使うだけの言及は高リスクにしない', () => {
    const cases = [
      'ルータが参照する `prisma` の import パスを揃える',
      '`gen:type-guards --check` は prisma generate に依存するか調べる',
      'Prisma 不要。スクリプト層に DB 依存を持ち込まない',
      'eslint ルール `no-raw-prisma-insensitive` をフロント config にも登録する',
    ];
    for (const plan of cases) {
      expect(detectHighRisk({ text: '', planContent: plan }).high).toBe(false);
    }
  });

  test('「スキーマ変更なし」と書いてあるだけの plan を高リスクにしない', () => {
    // 自然言語での判定を採らなかった理由の固定。plan がスキーマに言及するのは
    // 「触らない」と述べる場合が最も多く、文言一致は逆方向を指す。
    expect(
      detectHighRisk({ text: '', planContent: 'スキーマ変更なし。既存テーブルのみ参照する。' })
        .high,
    ).toBe(false);
    expect(detectHighRisk({ text: '', planContent: 'スキーマ変更は不要と判断した。' }).high).toBe(
      false,
    );
  });
});

// NOTE: 2026-08-24 実測。theme 1 の直近134タスクで detectHighRisk が発火したのは
// 10件、うち DATA_RISK_TEXT_RE 由来の7件は7件とも誤爆だった(スキーマを触るタスクは
// ゼロ)。全4ロールが premium 床に固定され、researcher 単体で $5.77 かかっていた。
// 下記は当時の Task 行そのままの部分文字列 — 上の負例群と同じく、言い換えでは
// 実発火率の回帰を検出できないため実文字列を使うこと。
describe('detectHighRisk 誤爆解消(コード引用・仮定・否定を含む実タスク負例)', () => {
  test('606: prisma クライアント呼び出しの言及は低リスク(スキーマ変更ではない)', () => {
    const text =
      '[Idea] ESLint で GitHubPullRequest の prNumber 単独検索を機械的に禁止する' +
      '\n新規コードが prisma.gitHubPullRequest.findFirst/findMany の where に' +
      ' integrationId 無しで prNumber を書くことは依然可能';
    expect(detectHighRisk({ text }).high).toBe(false);
  });

  test('596: 「スキーマ変更は不要」と明言する受入基準は低リスク', () => {
    const text =
      'PR番号のリポジトリ間衝突: prNumber単独lookupが別プロジェクトのPRを取り違える' +
      '\n3. 既存テストが green のままであること。' +
      '\n4. Prisma スキーマ変更は不要(既存の integrationId を使う)。';
    expect(detectHighRisk({ text }).high).toBe(false);
  });

  test('321: 「prismaモック不整合」はテスト基盤の話で低リスク', () => {
    const text =
      '[Refactor] テストスイート基盤の一括修復タスク化と優先度付け' +
      '\n現在26件の既存失敗テストが散在している（prismaモック不整合、' +
      'node:fs/promises export エラー、モック汚染など）。';
    expect(detectHighRisk({ text }).high).toBe(false);
  });

  test('「必要な場合は承認を待つ」定型の仮定文は低リスク', () => {
    const text = 'Prisma スキーマ変更が必要な場合は plan.md に明記して承認を待つ';
    expect(detectHighRisk({ text }).high).toBe(false);
  });

  test('引用符で囲んだ検索クエリ例は低リスク(データであって意図ではない)', () => {
    const text = 'ナレッジ検索の実測: "prisma schema migration"（英語）→ 5件 (top sim 0.647)';
    expect(detectHighRisk({ text }).high).toBe(false);
  });

  test('バッククォート内のコード片は低リスク', () => {
    const text = 'テスト側モックに `prisma.task.findUnique` が無いだけ';
    expect(detectHighRisk({ text }).high).toBe(false);
  });
});

// NOTE: 上の絞り込みが本物のスキーマ作業まで落としていないことの対向テスト。
// 誤爆を消す変更は必ずこの describe と対で維持すること。
describe('detectHighRisk 本物のデータ層作業は依然として高リスク', () => {
  test('モデル追加・マイグレーション・schema.prisma・db push はいずれも発火', () => {
    expect(detectHighRisk({ text: 'Prisma スキーマに Foo モデルを追加する' }).high).toBe(true);
    expect(detectHighRisk({ text: 'マイグレーションを追加してカラムを増やす' }).high).toBe(true);
    expect(detectHighRisk({ text: 'schema.prisma を変更してインデックスを張る' }).high).toBe(true);
    expect(detectHighRisk({ text: 'prisma db push を実行する手順を整える' }).high).toBe(true);
    expect(detectHighRisk({ text: 'Add a migration for the new column' }).high).toBe(true);
  });
});

// NOTE: 2026-08-24 実測。theme 1 の直近92 plan のうち、タスク本文は低リスクなのに
// plan 経由で premium へ昇格したものが 44 件(47.8%)あった。implementer と verifier は
// 最も高額なフェーズで、タスク658では $28.27 + $9.30 がこの昇格によるもの。
// 下記の負例はいずれも実 plan.md の行そのまま。
describe('detectHighRisk plan経路の誤爆解消(実plan負例)', () => {
  const TEXT = 'ある改善タスク';

  test('659: 「セキュリティでもなく」と判定した行は低リスク', () => {
    const planContent =
      "| type / severity | `type: 'other'` | 「バグ」でも「セキュリティ」でもなく、" +
      'CI/worktreeインフラの信頼性シグナルのため `other` を選択。修正は別途行う |';
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });

  test('658: schema ファイルを「足さない」と決めた行は低リスク', () => {
    const planContent =
      '| 6 | `MemoryTaskQueue.taskType` のコメント（`prisma/schema/memory.prisma`）に ' +
      '`reembed` を足すか | 足さない。schema ファイルの編集は再起動が必要 |';
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });

  test('599: 「非対象（やらないこと）」に並べた Prisma スキーマ変更は低リスク', () => {
    const planContent = '| 非対象（やらないこと） | Prisma スキーマ変更 / 判定式の緩和 |';
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });

  test('632: 「スキーマ変更不要」と書いた計測源の行は低リスク', () => {
    const planContent = '| 計測源 | `AgentExecution.cacheReadInputTokens`（スキーマ変更不要） |';
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });
});

// NOTE: 上の絞り込みが本物を落としていないことの対向テスト。plan 経路の誤爆を
// 減らす変更は必ずこの describe と対で維持すること。
describe('detectHighRisk plan が実際に触ると宣言したものは高リスク', () => {
  const TEXT = 'ある改善タスク';

  test('スキーマ/マイグレーション/認証/決済を変更する plan は発火', () => {
    const schemaPlan = [
      '### 変更',
      '| ファイル | 目的 |',
      '|---|---|',
      '| `prisma/schema/core.prisma` | Foo モデルを追加しインデックスを張る |',
    ].join(String.fromCharCode(10));
    expect(detectHighRisk({ text: TEXT, planContent: schemaPlan }).high).toBe(true);

    const migrationPlan = [
      '### 変更',
      '- `rapitas-backend/prisma/migrations/20260824_add_col/migration.sql` を追加',
    ].join(String.fromCharCode(10));
    expect(detectHighRisk({ text: TEXT, planContent: migrationPlan }).high).toBe(true);

    expect(
      detectHighRisk({
        text: TEXT,
        planContent: '認証フローの検証ロジックを修正し、トークンの失効を実装する',
      }).high,
    ).toBe(true);

    expect(
      detectHighRisk({
        text: TEXT,
        planContent: '- `services/payment/checkout.ts` の課金処理を修正する',
      }).high,
    ).toBe(true);
  });
});

// NOTE: 日本語には語境界が無いため、リスク語がより長い語の一部として素通しで
// 一致する。実測(2026-08-25): タスク660は plan の意思決定表にある
// 「別リクエストが既に解決済み」だけで implement/verify 両フェーズが premium に
// 固定され、実装1回で $13.55 かかっていた。
describe('detectHighRisk 日本語の部分文字列衝突', () => {
  test('「解決済み」は決済(payment)ではない', () => {
    const planContent =
      '| 自己修復の比較スワップが0件更新（別リクエストが既に解決済み） | ' +
      '`false` を返し `waitForVerifyCompletion` は通常どおり fallback |';
    expect(detectHighRisk({ text: 'ある改善タスク', planContent }).high).toBe(false);
  });

  test('research の未確定事項を「全て解決済み」と書いた plan も低リスク', () => {
    const planContent = 'research の未確定事項7件を全て解決済み。### 採用したアプローチ';
    expect(detectHighRisk({ text: 'ある改善タスク', planContent }).high).toBe(false);
  });

  test('本物の決済/課金は従来どおり高リスク', () => {
    expect(detectHighRisk({ text: '決済処理のリトライを実装する' }).high).toBe(true);
    expect(detectHighRisk({ text: 'Stripe の課金APIを修正する' }).high).toBe(true);
    expect(
      detectHighRisk({
        text: 'ある改善タスク',
        planContent: '- `services/payment/checkout.ts` の決済フローを変更',
      }).high,
    ).toBe(true);
  });
});

describe('detectHighRisk コードフェンス内の引用は意図ではない', () => {
  const FENCE = '```';

  test('貼り付けたルーティングトレースのreason文字列は低リスク', () => {
    const text = [
      'モデル選定の調査',
      '観測されたトレース:',
      FENCE,
      'minTier: premium, driver: floor',
      'adoptedReason: 高リスク領域(スキーマ/認証/決済/セキュリティ)のためpremiumへ引き上げ',
      FENCE,
      '複雑度は68だった。',
    ].join(String.fromCharCode(10));
    expect(detectHighRisk({ text }).high).toBe(false);
  });

  test('フェンスの外に本物の意図があれば発火する', () => {
    const text = ['認証フローを修正する', FENCE, 'some unrelated log output', FENCE].join(
      String.fromCharCode(10),
    );
    expect(detectHighRisk({ text }).high).toBe(true);
  });
});

const md = (...lines: string[]): string => lines.join(String.fromCharCode(10));

// NOTE: タスク661。plan 経路のパス形シグナルは plan 全文ではなく「変更予定ファイル」節が
// 宣言したパスに対して評価する。節外（依存関係表・非対象表・参考・設計判断表）の言及は
// 発火せず、`planScope: 'full'` で旧挙動（全文評価）を固定して差を示す。
describe('detectHighRisk 宣言節スコープ: 節外の言及は低リスク', () => {
  const TEXT = 'ある改善タスク';
  const BENIGN_DECL = [
    '## 変更予定ファイル',
    '| # | ファイル | 変更内容 |',
    '|---|---|---|',
    '| 1 | `services/workflow/routing-policy.ts` | 判定式を差し替え |',
  ];

  test('依存関係マップの prisma/schema 参照は低リスク（planScope:full では旧挙動どおり発火）', () => {
    const planContent = md(
      ...BENIGN_DECL,
      '## 依存関係マップ',
      '| `prisma/schema/memory.prisma` | MemoryTaskQueue を参照 |',
    );
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
    expect(detectHighRisk({ text: TEXT, planContent, planScope: 'full' }).high).toBe(true);
  });

  test('非対象表の「必要な場合は別タスク」は低リスク', () => {
    const planContent = md(
      ...BENIGN_DECL,
      '## 非対象',
      '- `prisma/schema/core.prisma` の変更が必要な場合は別タスクに切り出す',
    );
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });

  test('参考節の security-scan.yml 言及は低リスク（文脈語なし）', () => {
    const planContent = md(
      ...BENIGN_DECL,
      '## 参考',
      '- `.github/workflows/security-scan.yml` を CI の参考に読む',
    );
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });

  test('658 実文字列が設計判断表にあっても宣言節が良性なら低リスク', () => {
    const planContent = md(
      ...BENIGN_DECL,
      '## 設計判断の根拠',
      '| 6 | `MemoryTaskQueue.taskType` のコメント（`prisma/schema/memory.prisma`）に ' +
        '`reembed` を足すか | 足さない。schema ファイルの編集は再起動が必要 |',
    );
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(false);
  });
});

// NOTE: 対向テスト。宣言パスは否定スクラブを経由せず直接評価するため、宣言行に
// 「不要/変更しない」が共起しても発火する。旧挙動（planScope:full）では行スクラブが
// その行ごと消して偽陰性になっていたことを併せて固定する。
describe('detectHighRisk 宣言節スコープ: 宣言した本物は高リスク', () => {
  const TEXT = 'ある改善タスク';

  test('宣言行に「不要」が共起しても schema 変更は発火（旧挙動は偽陰性）', () => {
    const planContent = md(
      '## 変更予定ファイル',
      '| ファイル | 変更内容 |',
      '|---|---|',
      '| `prisma/schema/core.prisma` | Task.fooBar を追加。マイグレーションは不要(db push) |',
    );
    expect(detectHighRisk({ text: TEXT, planContent, planScope: 'full' }).high).toBe(false);
    const result = detectHighRisk({ text: TEXT, planContent });
    expect(result.high).toBe(true);
    expect(result.reason).toContain('plan declares changes');
  });

  test('宣言行に「変更しない」が共起しても auth ファイルは発火（旧挙動は偽陰性）', () => {
    const planContent = md(
      '## 変更予定ファイル',
      '| `routes/system/auth.ts` | トークン検証を修正。既存セッション形式は変更しない |',
    );
    expect(detectHighRisk({ text: TEXT, planContent, planScope: 'full' }).high).toBe(false);
    expect(detectHighRisk({ text: TEXT, planContent }).high).toBe(true);
  });

  test('migration / payment / schema ディレクトリの宣言はいずれも発火', () => {
    const migration = md(
      '## 変更ファイル',
      '- `rapitas-backend/prisma/migrations/20260824_add_col/migration.sql` を追加',
    );
    expect(detectHighRisk({ text: TEXT, planContent: migration }).high).toBe(true);
    const payment = md('## 対象ファイル', '- `services/payment/checkout.ts`');
    expect(detectHighRisk({ text: TEXT, planContent: payment }).high).toBe(true);
    const dir = md('## 変更予定ファイル', '- `prisma/schema/` 配下');
    expect(detectHighRisk({ text: TEXT, planContent: dir }).high).toBe(true);
  });

  test('宣言節が無い / パス0件の plan は全文評価へ fail-back して発火', () => {
    const noSection = 'prisma/schema/core.prisma を編集する';
    const r1 = detectHighRisk({ text: TEXT, planContent: noSection });
    expect(r1.high).toBe(true);
    expect(r1.reason).toContain('plan touches');
    const emptySection = md(
      '## 変更予定ファイル',
      '- ルーティング判定を修正する',
      '## 補足',
      '`prisma/schema/core.prisma` を編集する',
    );
    expect(detectHighRisk({ text: TEXT, planContent: emptySection }).high).toBe(true);
  });
});
