/**
 * RetroPrompt
 *
 * Prompt construction for the process retrospective's single AI call: the
 * jurisdiction-fixing system prompt (process metadata only — never re-review
 * artifacts) and the user-message evidence rendering. Pure formatting, no I/O.
 */
import { isCriticFollowRejection, PR_RECOVERY_CAUSES } from './retro-evidence';
import type { EvidenceBundle } from './retro-types';

/** System prompt fixing the retro AI's jurisdiction and output contract. */
export const RETRO_SYSTEM_PROMPT = `あなたはソフトウェア開発プロセスの回顧アナリストです。完了タスクの実行トレース
(遷移タイムライン・差し戻し回数と理由・フェーズ別所要時間・異常cause)から、
プロセスの摩擦・系統的欠陥の兆候だけを評価してください。

厳守事項:
- 成果物(research/plan/verifyの内容そのもの)の再レビューはしないこと。評価対象は
 プロセスのメタデータのみ。差し戻し理由(reasons)は「ゲートがどう機能したか」の
 証拠としてのみ用いてよい。
- 判定基準: 同一causeの反復(2回以上)・批評差し戻しの反復・フェーズ所要時間の
 極端な偏り(過短/過長)・異常causeの存在は systemic=true を示唆する。1タスク限りの
 偶発は systemic=false とする。
- 批評差し戻し(critic_failed)の直後に記録される transition_rejected(批評追随拒否)は、
 非同期の批評ゲートが成果物を巻き戻した直後に、先へ進んでいたエージェントの保存を
 状態機械が正しく拒否した「単一の想定内自己修復連鎖」である。異常cause・不変条件
 違反・独立したcause反復として扱わないこと(複数ゲートの同時機能不全ではない)。
- キュー待機(初回ディスパッチ前の滞在)は auto-run停止・サーバー停止などの非稼働
 期間を含む待機時間であり、実行系の遅延ではない。phase_wallclock 異常の根拠に
 しないこと。フェーズ所要時間の判定は「フェーズ別所要時間」に示された実行中の
 滞在のみで行う。
- verify_pr_not_created・verify_pr_retry_lightweight(PR作成再試行系、内訳は
 「cause別カウント」の "PR作成再試行系(pr_recovery)" を参照)は、verify_repair
 (実装内容の差し戻し)とは別の失敗パターンであり、既に専用の上限付き自動復旧と
 再試行上限到達によるエスカレーション基準が実装済みである。この2causeの反復
 回数だけを根拠に「修復ロジックが機能していない」「エスカレーション基準が
 未実装」と結論しないこと(反復後にタスクが completed に到達していれば、
 既存の復旧機構が正常に機能した証拠であり systemic ではない)。ただし遷移
 タイムラインに blocked_escalated が現れる場合は、実際に上限へ到達した事象
 として通常どおり評価してよい。
- 該当が無ければ findings を空配列にすること。無理に起票しない。

出力は次のJSONのみ(前置き・コードフェンス不要):
{"findings":[{"category":"<enum>","severity":"urgent|high|medium|low",
"systemic":true|false,"slug":"<小文字英数とハイフン3〜40字>",
"recommendation":"改善提案1〜2文","evidence":"根拠となるトレース上の事実"}]}

categoryは次のいずれか: critic_loop, repair_loop, replan_loop, anomaly_cause,
phase_wallclock, gate_jurisdiction, process_other`;

/** Cap on rendered critic reasons (richest signal, but must stay bounded). */
const MAX_REASONS = 12;
/** Per-reason length cap in the rendering. */
const REASON_MAX_CHARS = 200;

/**
 * Render the evidence bundle as a compact Markdown summary (also reused as the
 * filed concern's bundle-summary section). Pure formatter.
 *
 * @param bundle - The evidence bundle. / 証拠バンドル
 * @returns Markdown summary. / Markdown要約
 */
export function formatEvidenceSummary(bundle: EvidenceBundle): string {
  const timelineLines =
    bundle.timeline.length > 0
      ? bundle.timeline.map(
          (t) =>
            `- ${t.createdAt.toISOString()} — ${t.fromStatus ?? '(初回)'} → ${t.toStatus}` +
            ` (actor: ${t.actor}, cause: ${t.cause}${t.phase ? `, phase: ${t.phase}` : ''}` +
            `${t.invariantViolation ? ', invariantViolation' : ''})`,
        )
      : ['- (遷移履歴なし)'];

  const reasonLines =
    bundle.criticReasons.length > 0
      ? bundle.criticReasons
          .slice(0, MAX_REASONS)
          .map((r) => `- ${r.length > REASON_MAX_CHARS ? `${r.slice(0, REASON_MAX_CHARS)}…` : r}`)
      : ['- (差し戻し理由なし)'];

  const phaseEntries = Object.entries(bundle.phaseTimings);
  const phaseLines =
    phaseEntries.length > 0
      ? phaseEntries.map(([state, ms]) => `- ${state}: ${(ms / 60_000).toFixed(1)}分`)
      : ['- (所要時間データなし)'];

  // Rendered only when non-zero so zero-wait summaries (the common case, and
  // all previously-filed concern details) keep their existing shape. The cause
  // facts (interval / causes during the wait / dispatch trigger) RECORD why
  // the wait happened; this summary is persisted into filed concerns.
  const detail = bundle.queueWaitDetail;
  const queueWaitLines =
    bundle.queueWaitMs > 0
      ? [
          '',
          '## キュー待機(初回ディスパッチ前)',
          `- 待機時間: ${(bundle.queueWaitMs / 60_000).toFixed(1)}分${
            detail ? ` (${detail.waitStartAt} → ${detail.dispatchAt})` : ''
          }`,
          ...(detail
            ? [
                `- 待機中の遷移cause: ${Object.entries(detail.preDispatchCauses)
                  .map(([cause, n]) => `${cause} ×${n}`)
                  .join(', ')}`,
                `- 待機を解消したディスパッチcause: ${detail.dispatchCause}`,
              ]
            : []),
          // NOTE: 102ms は task#516 調査の実測値(cycle-2026-08-12.ndjson:
          // theme.started 01:08:52.579Z → task.enqueued 01:08:52.681Z)。
          '- 原因: ディスパッチ主体(テーマauto-run)が当該タスクを起動しない非実行期間(auto-run停止・サーバー停止・先行タスク処理中)の滞留であり、スケジューラ/キューのトリガー遅延ではない(task#516調査の実測: auto-run開始→タスクenqueueは102ms)。フェーズ別所要時間からは除外済みで、phase_wallclock 異常の根拠にしないこと。',
        ]
      : [];

  // Informational: an intervention is under measurement, so the retro AI must
  // not attribute its (positive or negative) effect to systemic process change.
  const experimentLines = bundle.experiment
    ? [
        '## 実験中(効果測定対象)',
        `- 対象ロール: ${bundle.experiment.role} のプロンプトに検証中の介入が注入されています (仮説#${bundle.experiment.hypothesisId})`,
        `- 仮説: ${bundle.experiment.statement}`,
        '- このタスクの摩擦/改善は実験介入の影響を受けている可能性があるため、systemic 判定は慎重に行うこと。',
        '',
      ]
    : [];

  return [
    ...experimentLines,
    `## 対象タスク`,
    `- ID: ${bundle.taskId} / タイトル: ${bundle.title || '(不明)'}`,
    '',
    '## cause別カウント',
    `- 批評差し戻し(critic): ${bundle.criticRebounds}回`,
    `- 修復系(repair): ${bundle.repairCount}回`,
    `- 再計画(replan): ${bundle.replanCount}回`,
    // Rendered only when non-zero so zero-count summaries (and all
    // previously-filed concern details) keep their existing shape.
    ...(bundle.prRecoveryCount > 0
      ? [
          `- PR作成再試行系(pr_recovery): ${bundle.prRecoveryCount}回`,
          '- 注記: PR作成再試行系(verify_pr_not_created / verify_pr_retry_lightweight)は、上限付き自動復旧とエスカレーション基準が既に実装済みの別の失敗パターンであり、修復系(repair)の反復とは区別して評価すること。',
        ]
      : []),
    `- 異常系(anomaly): ${bundle.anomalyCount}回`,
    // Rendered only when non-zero so zero-count summaries (and all
    // previously-filed concern details) keep their existing shape.
    ...(bundle.criticFollowRejections > 0
      ? [
          `- 批評追随拒否(critic_follow): ${bundle.criticFollowRejections}回`,
          '- 注記: 批評追随拒否は、非同期の批評差し戻し直後に進行中エージェントの保存を状態機械が正しく拒否した想定内の自己修復連鎖であり、異常causeや独立した不変条件違反ではない(異常系カウントからは除外済み)。',
        ]
      : []),
    `- 不変条件違反(invariantViolation): ${bundle.invariantCount}行`,
    '',
    `## 批評差し戻し理由(最大${MAX_REASONS}件)`,
    ...reasonLines,
    '',
    '## フェーズ別所要時間(状態滞在時間)',
    ...phaseLines,
    ...queueWaitLines,
    '',
    '## 遷移タイムライン(全件)',
    ...timelineLines,
  ].join('\n');
}

/**
 * Build the user message for the retro AI: the evidence summary plus explicit
 * systemicity hints (repeated causes ≥2, critic bounces ≥2).
 *
 * @param bundle - The evidence bundle. / 証拠バンドル
 * @returns User-message Markdown. / ユーザメッセージ
 */
export function buildRetroPrompt(bundle: EvidenceBundle): string {
  const prRecoverySet = new Set<string>(PR_RECOVERY_CAUSES);
  const causeCounts = new Map<string, number>();
  for (const t of bundle.timeline) {
    // Critic-follow rejections are the designed self-repair chain — excluded
    // here too, or `transition_rejected ×2` would falsely fire the
    // repeated-cause systemicity hint the aggregation fix just removed.
    // PR-recovery causes (verify_pr_not_created / verify_pr_retry_lightweight,
    // task 713) are excluded for the same reason: they already have a bounded
    // auto-recovery + escalation mechanism, so their repetition alone
    // previously produced a false systemic hint (task#705, K-7246) even when
    // the task went on to complete normally.
    if (isCriticFollowRejection(t) || prRecoverySet.has(t.cause)) continue;
    causeCounts.set(t.cause, (causeCounts.get(t.cause) ?? 0) + 1);
  }
  const repeated = [...causeCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([cause, n]) => `- ${cause}: ${n}回`);

  const hints = [
    '## 系統性ヒント',
    '- 同一causeの2回以上の反復、批評差し戻し2回以上は systemic=true を示唆する。',
    repeated.length > 0
      ? ['- このタスクで2回以上反復したcause:', ...repeated].join('\n')
      : '- このタスクで2回以上反復したcauseはない。',
    `- 批評差し戻し回数: ${bundle.criticRebounds}回`,
    ...(bundle.prRecoveryCount >= 2
      ? [
          `- PR作成再試行系(pr_recovery)の反復: ${bundle.prRecoveryCount}回(既存の上限付き自動復旧対象であり、単独では systemic の根拠にしないこと)`,
        ]
      : []),
  ].join('\n');

  return `${formatEvidenceSummary(bundle)}\n\n${hints}`;
}
