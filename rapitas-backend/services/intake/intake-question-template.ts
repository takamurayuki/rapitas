/**
 * Intake Question Template
 *
 * Builds the `question.md` body shown in the workflow Q&A tab when a task's
 * spec is too thin to run autonomously. Pure string construction — no IO.
 */
import { specFieldLabel, type SpecField } from './spec-quality-checker';

/** Inputs for {@link buildIntakeQuestion}. */
export interface IntakeQuestionInput {
  /** Task title, for context in the question. / 文脈用のタスクタイトル */
  title: string;
  /** Spec fields detected as missing. / 不足している仕様項目 */
  missing: SpecField[];
  /** Heuristic reasons the spec was judged thin. / 仕様が薄いと判定した根拠 */
  reasons: string[];
  /**
   * Selectable goal options to present (preferably AI-generated and task-specific).
   * When omitted, a task-type heuristic ({@link intakeGoalOptions}) is used.
   */
  options?: string[];
}

/** Marks the start of the selectable-choices block the UI parses. */
export const INTAKE_OPTIONS_HEADING = '## 選択肢';

/**
 * Plausible GOAL directions for a task, offered as selectable choices so the user
 * picks instead of free-typing (per the Claude-web-style preference: present
 * options whenever possible). Derived from the task-type prefix; a free-text
 * "その他" is always available in the UI as the fallback. Kept generic-but-useful —
 * the user can still elaborate in free text.
 *
 * @param title - Task title (its `[Perf]`/`[Refactor]`/`[Bug]` prefix steers the set). / タスクタイトル
 * @returns 2-4 goal-direction option strings. / ゴール方向の選択肢
 */
export function intakeGoalOptions(title: string): string[] {
  if (/\[perf\]|パフォ|最適化|高速|スループット|レイテン|perf/i.test(title)) {
    return [
      '実行時間・レスポンスを短縮する（速度優先）',
      'メモリ・リソース使用量を削減する',
      'スループット・同時処理性を向上する',
    ];
  }
  if (/\[refactor\]|リファク|共通化|一元化|標準化|refactor/i.test(title)) {
    return [
      '保守性・可読性を高める（重複排除・整理）',
      '型安全性・堅牢性を強化する',
      'テスト容易性・拡張性を高める',
    ];
  }
  if (/\[bug\]|バグ|不具合|障害|bug|fix/i.test(title)) {
    return ['不具合を修正し再発を防止する', 'エラーハンドリング・回復性を改善する'];
  }
  return ['機能を追加・改善する', '品質・信頼性を高める', 'パフォーマンスを最適化する'];
}

/**
 * Build the markdown body for an intake clarifying question.
 *
 * The user answers in the Q&A tab; on resume the intake gate re-derives the
 * spec from this file's answer, so free-text elaboration is expected here.
 *
 * @param input - Title, missing fields, and reasons. / タイトル・不足項目・根拠
 * @returns Markdown body for `question.md`. / question.md 用のMarkdown本文
 */
export function buildIntakeQuestion(input: IntakeQuestionInput): string {
  const lines: string[] = [];
  lines.push('# 仕様確認');
  lines.push('');
  lines.push(
    `タスク「${input.title}」を自律実行するには、仕様が不足しています。以下を具体的に追記してください。`,
  );
  lines.push('');

  if (input.missing.length > 0) {
    lines.push('## 不足している項目');
    for (const field of input.missing) {
      lines.push(`- ${specFieldLabel(field)}`);
    }
    lines.push('');
  }

  if (input.reasons.length > 0) {
    lines.push('## 判定理由');
    for (const reason of input.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  // Selectable goal choices — the UI parses bullets under INTAKE_OPTIONS_HEADING
  // and renders them as buttons (plus an always-available "その他" free-text).
  // Prefer caller-supplied (AI-generated) options; fall back to the task-type heuristic.
  const options =
    input.options && input.options.length > 0 ? input.options : intakeGoalOptions(input.title);
  if (options.length > 0) {
    lines.push(INTAKE_OPTIONS_HEADING);
    for (const opt of options) lines.push(`- ${opt}`);
    lines.push('');
  }

  lines.push('## 回答方法');
  lines.push(
    '上の選択肢から最も近いゴールを選ぶか、達成したいこと・守るべき制約・「完了」と言える条件を自由記述で記入してください。',
  );
  lines.push('回答後にワークフローを再開すると、内容を仕様へ反映して調査フェーズに進みます。');
  lines.push('');

  return lines.join('\n');
}
