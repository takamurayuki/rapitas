/// 原因コードを平易な日本語に直す対応表（ラピ伴走化 第2段階-2）。
///
/// バックエンドはコード（haltReason・修復の原因分類・保留理由・伴走の要約の出来事）だけを返し、
/// 文にするのはこの表だけ。モデルは使わないので、未知のコードはコードを添えてそのまま見せる
/// （黙って別の文にすり替えない）。
library;

const Map<String, String> _haltReasons = {
  // 反復予算による停止（rapitas-backend services/workflow/task-iteration-budget.types.ts）
  'budget_time_exceeded': '作業時間の上限に達したため、自動で止まっています。',
  'budget_cost_exceeded': '費用の上限に達したため、自動で止まっています。',
  'budget_attempts_exceeded': 'やり直しの回数が上限に達したため、自動で止まっています。',
  'repeat_cause_detected': '同じ原因の失敗が続いたため、自動で止まっています。',
  'no_progress': '進み具合が見られないため、自動で止まっています。',
  // レビュー保留（services/workflow/review-hold.ts）
  'awaiting_review_decision': 'レビューの結論が出ず、あなたの判断を待っています。',
  // NOTE: 発生源は第2段階バッチB（陪審の判定中に完了条件の版がずれたとき、判定を適用せずに止める）。
  // 表示を先に用意しておく
  'jury_result_discarded': '確認の途中で完了条件が変わったため、その判定は使わずに止めています。',
};

/// 止まっている理由の平易な文。未知のコードは理由コードを添えて返す
String haltReasonText(String haltReason) =>
    _haltReasons[haltReason] ?? '自動で止まっています（理由: $haltReason）。';

const Map<String, String> _repairCauses = {
  // services/workflow/repair-cause.ts の RepairCauseKind
  'capability': '作業の中身に足りない点が見つかり、直しに戻りました。',
  'infrastructure': '実行環境の問題（接続やツールの不足など）で、正しく確かめられませんでした。',
  'requirements': '要件や計画のほうに食い違いが見つかり、計画から見直しています。',
  'unfounded': '根拠のない指摘で差し戻されました（作業の不足としては数えません）。',
};

/// 修復（差し戻し）の原因分類の平易な文
String repairCauseText(String cause) =>
    _repairCauses[cause] ?? '差し戻されました（原因: $cause）。';

const Map<String, String> _holdReasons = {
  // services/agents/verification/jury-seat-types.ts の ReviewHoldReason
  'jury_unavailable_high_risk': '影響の大きい変更なのに、レビュー役がそろわず確認できませんでした。',
  'unresolved_dispute': '2人のレビュー役の意見が割れ、検証役でも決着しませんでした。',
  'ineligible_verifier': '意見の割れを裁く検証役を用意できませんでした。',
};

/// レビュー保留の理由の平易な文
String holdReasonText(String reason) =>
    _holdReasons[reason] ?? 'レビューの結論が出ませんでした（理由: $reason）。';

/// 判断の種類ごとの見出しと、あなたが決めること
class DecisionCopy {
  final String title;
  final String ask;
  const DecisionCopy(this.title, this.ask);
}

const Map<String, DecisionCopy> _decisions = {
  'approve_plan': DecisionCopy('計画の承認', 'この計画で進めてよいかを決めてください。'),
  'answer_question': DecisionCopy('質問への回答', 'エージェントからの質問に答えてください。'),
  'review_hold':
      DecisionCopy('レビュー保留の判断', '指摘を受け入れて直してもらうか、このまま進めるかを決めてください。'),
  'release_halt': DecisionCopy('停止の解除', '次はなぜうまくいくのかを書いて、再開するかを決めてください。'),
};

/// 判断の種類（approve_plan など）の見出しと問いかけ
DecisionCopy decisionCopy(String kind) =>
    _decisions[kind] ?? DecisionCopy('判断', 'あなたの判断を待っています（種類: $kind）。');

const Map<String, String> _events = {
  'halted': '自動で止まりました',
  'review_held': 'レビューの結論が出ず、保留になりました',
  'question': 'エージェントから質問が届きました',
  'repair': '検証で差し戻され、直しに戻りました',
  'replanned': '計画を立て直しました',
  'plan_ready': '計画ができました',
  'decided': 'あなたの判断が反映されました',
  'completed': '完了しました',
};

/// 伴走の要約の出来事1件の文。progress は進んだ先の段階名を [stageLabel] でもらう
String digestEventText(String kind, {String? stageLabel}) {
  if (kind == 'progress') return stageLabel == null ? '進みました' : '「$stageLabel」に進みました';
  return _events[kind] ?? '動きがありました（$kind）';
}
