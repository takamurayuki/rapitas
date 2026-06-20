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

  lines.push('## 回答方法');
  lines.push(
    '達成したいこと・守るべき制約・「完了」と言える条件を、箇条書きで構いませんので記入してください。',
  );
  lines.push('回答後にワークフローを再開すると、内容を仕様へ反映して調査フェーズに進みます。');
  lines.push('');

  return lines.join('\n');
}
