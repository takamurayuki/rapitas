/**
 * routing-policy テスト
 *
 * ロール下限・リスクオーバーライド・失敗エスカレーションのティア決定を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { highestTier, isCapabilityRole, detectHighRisk, computeMinTier } from './routing-policy';

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
  test('テーマレベル2でもタスク固有シグナルは premium を維持する', () => {
    // The cap applies to the THEME signal only — retry and risk still escalate.
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 1, themeEscalation: 2, riskHigh: false }),
    ).toBe('premium');
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 0, themeEscalation: 2, riskHigh: true }),
    ).toBe('premium');
  });
  test('高リスクは premium に引き上げ', () => {
    expect(computeMinTier({ role: 'planner', taskRetries: 0, riskHigh: true })).toBe('premium');
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
  test('高リスク/タスクリトライ時は実証済みでも premium を維持', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: true,
        provenTier: 'economy',
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
