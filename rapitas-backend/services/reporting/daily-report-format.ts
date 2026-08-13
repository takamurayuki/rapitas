/**
 * daily-report-format
 *
 * Rendering layer of the autonomous-activity daily report: the guaranteed
 * plain-markdown fallback (never throws), the one-line notification summary,
 * and the optional aux-AI polish (throws — caller falls back). Aggregation
 * lives in daily-report-core; persistence in daily-report-service.
 */
import { callClaudeForReview } from '../ai/weekly-review-service';
import type { DailyReportData } from './daily-report-core';

/**
 * One-line summary used as the notification message (bell preview).
 *
 * @param data - Aggregated report data / 集計済みデータ
 * @returns Single-line Japanese summary / 1行サマリ
 */
export function formatDailyReportSummary(data: DailyReportData): string {
  const parts = [
    `完了${data.completedTasks.length}件`,
    `PRマージ${data.mergedPrs.items.length}件`,
    `懸念${data.concerns.total}件`,
    `意思決定${data.decisions.length}件`,
    `再起動${data.restartCount}回`,
    data.humanIntervention.occurred ? `人間介入${data.humanIntervention.count}件` : '人間介入なし',
  ];
  if (data.satiated) parts.push('飽和静止');
  return `${data.date} の自律活動: ${parts.join(' / ')}`;
}

/**
 * Render the aggregate as plain markdown tables. This is the fail-open output
 * used verbatim when the aux AI is unavailable — it must never throw.
 *
 * @param data - Aggregated report data / 集計済みデータ
 * @returns Markdown report / Markdown形式のレポート
 */
export function formatDailyReport(data: DailyReportData): string {
  const intervention = data.humanIntervention.occurred
    ? `あり (${data.humanIntervention.count}件)`
    : 'なし';
  const head = [
    `# デイリーレポート ${data.date}`,
    '',
    `集計窓: ${data.windowStart} 〜 ${data.windowEnd}（直近24時間）`,
    '',
    '## サマリ',
    '',
    '| 項目 | 件数 |',
    '| --- | --- |',
    `| 完了タスク | ${data.completedTasks.length} |`,
    `| マージ済みPR（近似） | ${data.mergedPrs.items.length} |`,
    `| 起票された懸念 | ${data.concerns.total} |`,
    `| 意思決定 | ${data.decisions.length} |`,
    `| 自己再起動 | ${data.restartCount} |`,
    `| 人間介入 | ${intervention} |`,
    '',
  ];

  // Requirement #4: on satiated days state WHY the loop stood still.
  const satiatedSection =
    data.satiated && data.satiatedReason
      ? ['## 静止していた理由', '', data.satiatedReason, '']
      : [];

  const completed = data.completedTasks.map(
    (t) => `- #${t.id} ${t.title}${t.prNumber != null ? `（PR #${t.prNumber}）` : ''}`,
  );
  const merged = data.mergedPrs.items.map((pr) => `- PR #${pr.prNumber} ${pr.title}`);

  const sourceRows = Object.entries(data.concerns.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `| ${source} | ${count} |`);
  const concernLines =
    sourceRows.length === 0 ? ['- なし'] : ['| 発生源 | 件数 |', '| --- | --- |', ...sourceRows];

  const learnings = [
    ...data.learnings.retro.map((l) => `- [回顧] ${l}`),
    ...data.learnings.incident.map((l) => `- [インシデント] ${l}`),
  ];
  const decisions = data.decisions.map(
    (d) => `- [${d.actor}] ${d.decision}${d.rationale ? ` — 理由: ${d.rationale}` : ''}`,
  );
  const queue = data.upcomingQueue.map(
    (t, i) => `${i + 1}. #${t.id} ${t.title}（優先度: ${t.priority}）`,
  );

  const orNone = (lines: string[]) => (lines.length === 0 ? ['- なし'] : lines);
  return [
    ...head,
    ...satiatedSection,
    `## 完了タスク (${data.completedTasks.length}件)`,
    '',
    ...orNone(completed),
    '',
    `## マージ済みPR (${data.mergedPrs.items.length}件・近似)`,
    '',
    ...orNone(merged),
    '',
    `## 起票された懸念 (${data.concerns.total}件)`,
    '',
    ...concernLines,
    '',
    '## 回顧・インシデントの学び',
    '',
    ...orNone(learnings),
    '',
    `## 意思決定 (${data.decisions.length}件)`,
    '',
    ...orNone(decisions),
    '',
    '## 自己再起動',
    '',
    `- 合計 ${data.restartCount} 回（cycle log: ${data.restartBreakdown.fromCycleLog} / 通知: ${data.restartBreakdown.fromNotifications}）`,
    '',
    '## 次に着手予定のキュー先頭3件（プレビュー）',
    '',
    ...(queue.length === 0 ? ['- なし（実行可能なバックログが空です）'] : queue),
    '',
  ].join('\n');
}

/**
 * Ask the aux AI (CLI preferred, API fallback — weekly-review's proven path)
 * to rewrite the plain aggregate into a readable morning report. Throws when
 * the aux AI is off, fails, or returns empty — the CALLER catches and falls
 * back to the plain tables (fail-open).
 *
 * @param data - Aggregated report data / 集計済みデータ
 * @returns AI-polished markdown / AI整形済みMarkdown
 * @throws {Error} When the aux AI is unavailable or returns nothing / 補助AI不可時
 */
export async function aiFormatDailyReport(data: DailyReportData): Promise<string> {
  const plain = formatDailyReport(data);
  const prompt = `あなたは自律開発エージェントの活動を毎朝人間に報告するアシスタントです。
以下の集計データ(markdown)を、人間が5分で監査できる読みやすい日次レポートに整形してください。

制約:
- 出力はmarkdownのみ（前置き・後書きの会話文は書かない）
- 見出し「# デイリーレポート ${data.date}」から始める
- 全セクション（完了タスク/マージ済みPR/懸念/学び/意思決定/自己再起動/人間介入/次のキュー${data.satiated ? '/静止していた理由' : ''}）の事実を保持する
- 件数・番号（タスクID・PR番号）を改変しない
- 冒頭に2〜3文の総括を加える

## 集計データ
${plain}`;

  return callClaudeForReview(prompt);
}
