/**
 * Intake Question Template
 *
 * Builds the `question.md` body shown in the workflow Q&A tab when a task's
 * spec is too thin to run autonomously. Pure string construction — no IO.
 */
import { specFieldLabel, type SpecField } from './spec-quality-checker';
import type { IntakeQuestion } from '../task/task-spec-deriver';

/** Inputs for {@link buildIntakeQuestion}. */
export interface IntakeQuestionInput {
  /** Task title, for context in the question. / 文脈用のタスクタイトル */
  title: string;
  /** Spec fields detected as missing. / 不足している仕様項目 */
  missing: SpecField[];
  /** Heuristic reasons the spec was judged thin. / 仕様が薄いと判定した根拠 */
  reasons: string[];
  /**
   * One focused question per missing field (1問1答), AI-generated. When provided,
   * each is rendered as a `## 質問N` block the UI shows one at a time. When omitted,
   * a single fallback goal question with task-type heuristic options is rendered.
   */
  questions?: IntakeQuestion[];
  /**
   * Emit a `json:options` block recommending each question's narrowest-scope
   * option, so the stale-question auto-answer pass can adopt it unattended.
   * Set only for backlog-promoted tasks; human-filed ones wait for the human.
   */
  autoAdopt?: boolean;
}

/** Marks the start of the selectable-choices block the UI parses. */
export const INTAKE_OPTIONS_HEADING = '### 選択肢';
/** Prefix of each per-question heading the UI parses (1問1答). */
export const INTAKE_QUESTION_PREFIX = '## 質問';

/**
 * Why the narrowest option is recommended — surfaced in the block so the
 * auto-answer audit (and the human reading question.md) sees the policy.
 */
export const INTAKE_AUTO_ADOPT_REASON =
  '自動起票タスクは最小スコープを既定とする（2026-09-23 運用方針）。無応答のまま一定時間が過ぎるとこの選択肢を自動採用する。より広いスコープが必要なら回答で選び直すか、タスクを分割して起票する。';

/**
 * Machine-readable `json:options` block for intake questions, shaped the way
 * question-options-parser.ts expects (id / summary / options[key,label] /
 * recommended / recommendedReason). Questions without options are skipped —
 * they cannot be auto-adopted anyway.
 *
 * @param questions - Rendered intake questions. / 出力した質問
 * @returns Fenced block text, or '' when no question has options. / ブロック文字列
 */
function autoAdoptOptionsBlock(questions: IntakeQuestion[]): string {
  const keys = 'ABCD';
  const items = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.options.length > 0)
    .map(({ q, i }) => {
      const idx = Math.min(Math.max(q.recommendedIndex ?? 0, 0), q.options.length - 1);
      return {
        id: `Q${i + 1}`,
        summary: q.question,
        options: q.options.map((label, j) => ({ key: keys[j] ?? String(j + 1), label })),
        recommended: keys[idx] ?? String(idx + 1),
        recommendedReason: INTAKE_AUTO_ADOPT_REASON,
      };
    });
  if (items.length === 0) return '';
  return ['```json:options', JSON.stringify({ questions: items }, null, 2), '```', ''].join('\n');
}

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
/**
 * One heuristic question per missing spec field, used when AI question generation
 * is unavailable. Goals use the task-type goal options; constraints/acceptance use
 * generic-but-useful choices. Always yields at least one (goals) question.
 *
 * @param title - Task title (steers the goal options). / タスクタイトル
 * @param missing - Spec fields detected as missing. / 不足項目
 * @returns One question per missing field. / 項目ごとの質問
 */
function fallbackQuestions(title: string, missing: SpecField[]): IntakeQuestion[] {
  const fields: SpecField[] = missing.length > 0 ? missing : ['goals'];
  return fields.map((field) => {
    if (field === 'constraints') {
      return {
        field,
        question: '守るべき制約・前提はどれですか？',
        options: [
          '既存の挙動・出力を変えない',
          'スコープを限定する（最小変更）',
          '後方互換性を保つ',
        ],
      };
    }
    if (field === 'acceptanceCriteria') {
      return {
        field,
        question: '「完了」と判定する基準はどれですか？',
        options: ['関連テストが全て通る', '計測値で改善を確認できる', 'レビューで動作を確認できる'],
      };
    }
    return {
      field: 'goals',
      question: 'このタスクで達成すべきゴール（最も重視すること）はどれですか？',
      options: intakeGoalOptions(title),
    };
  });
}

export function buildIntakeQuestion(input: IntakeQuestionInput): string {
  const lines: string[] = [];
  lines.push('# 仕様確認');
  lines.push('');
  lines.push(
    `タスク「${input.title}」を自律実行するには、仕様が不足しています。以下の質問に1問ずつお答えください。`,
  );
  lines.push('');

  // 1問1答: prefer AI-generated per-field questions; fall back to ONE heuristic
  // question per missing field. Each `## 質問N` block carries its own `### 選択肢`
  // so the UI can show them one at a time with clear question↔answer correspondence.
  const questions: IntakeQuestion[] =
    input.questions && input.questions.length > 0
      ? input.questions
      : fallbackQuestions(input.title, input.missing);

  questions.forEach((q, i) => {
    const label = specFieldLabel((q.field as SpecField) ?? 'goals');
    lines.push(`${INTAKE_QUESTION_PREFIX}${i + 1}: ${label}`);
    lines.push(q.question);
    if (q.options.length > 0) {
      lines.push(INTAKE_OPTIONS_HEADING);
      for (const opt of q.options) lines.push(`- ${opt}`);
    }
    lines.push('');
  });

  lines.push('## 回答方法');
  lines.push(
    '各質問について、選択肢から選ぶか、当てはまらない場合は自由記述で回答してください。すべて回答するとワークフローを再開し、内容を仕様へ反映して調査フェーズに進みます。',
  );
  lines.push('');

  // Last, after the human-readable blocks: the intake UI parses `## 質問N` /
  // `### 選択肢` headings by prefix and must keep seeing them unchanged.
  if (input.autoAdopt) {
    const block = autoAdoptOptionsBlock(questions);
    if (block) lines.push(block);
  }

  return lines.join('\n');
}
