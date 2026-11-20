/**
 * research-criteria-question
 *
 * Writes the question.md a person answers when the researcher's review of the
 * completion criteria says "revise": the findings, the rewrite, and the
 * `json:options` block the question screen turns into buttons. Pure text —
 * stopping the workflow and applying the answer live in
 * research-criteria-review.ts.
 */
import type { CriteriaReview } from './criteria-review';

/** The id of the one question in the options block; the answer is matched on it. */
export const CRITERIA_QUESTION_ID = 'criteria';

/** Option keys of the criteria question. */
export const CRITERIA_OPTION = { adopt: 'adopt', keep: 'keep' } as const;

const KIND_JA: Record<string, string> = {
  unverifiable: '作業中に確かめられない',
  contradiction: '制約・範囲外と矛盾する',
  insufficient: '満たしてもゴールに届かない',
  ambiguous: '読み方が割れる',
  unrelated: 'このタスクと関係がない',
};

/** Finding kinds that mean the criterion does not say what the person wants. */
const PURPOSE_KINDS = new Set(['insufficient', 'ambiguous']);

/**
 * The open items that ask the person something.
 *
 * NOTE: 未確定事項 also holds the researcher's own to-dos (「全数確認する」,
 * 「詳細に確認する」). Listed as questions they asked the person to do the
 * research (task 1510), so only items phrased as a question are kept: one
 * with 「か」 closing a clause, or a question mark.
 */
function asks(items: string[]): string[] {
  return items.filter((item) => /か[。、？?]|か$|[？?]/.test(item.trim()));
}

/**
 * Whether no criterion says what the person wants: every one carries an
 * insufficient or ambiguous finding. Then the rewrite is the researcher's
 * guess at the goal, not a sharper way to check a known one.
 *
 * @param criteria - The criteria as they stand / 現在の受入条件
 * @param review - The researcher's review / 点検結果
 * @returns True when the purpose itself is missing / 目的が読み取れない場合 true
 */
export function purposeUnclear(criteria: string[], review: CriteriaReview): boolean {
  if (criteria.length === 0) return false;
  return criteria.every((_, i) =>
    review.findings.some((f) => (f.index === i || f.index === null) && PURPOSE_KINDS.has(f.kind)),
  );
}

/**
 * The machine-readable choices, as the question screen reads them.
 *
 * NOTE: Asked 2026-11-20 — the screen showed only a free-text box. A rewrite
 * the researcher could make is now one button. The box is shown only when the
 * purpose is missing, because only the person can say what they want. It
 * carries no button then: the question screen hides the buttons of a
 * free-text question, and a guess at the goal is not something to adopt with
 * one click anyway.
 */
function optionsBlock(review: CriteriaReview, unclear: boolean): string {
  const adopt = {
    key: CRITERIA_OPTION.adopt,
    label: '推奨の完了条件に書き換える',
    consequence: '完了条件を「書き直し」の案に書き換え、調査はやり直さずに計画から進む',
  };
  const keep = {
    key: CRITERIA_OPTION.keep,
    label: '今の完了条件のまま進める',
    consequence: '完了条件は変えずに計画から進む。指摘された点で差し戻されることがある',
  };
  const question = unclear
    ? {
        id: CRITERIA_QUESTION_ID,
        summary: '何を良くしたいか',
        options: [],
        freeTextRequired: true,
        freeTextReason:
          '完了条件から目的が読み取れず、何を良くしたいかは依頼した人にしか決められないため',
        recommended: '',
        recommendedReason: '',
      }
    : {
        id: CRITERIA_QUESTION_ID,
        summary: '完了条件を書き換えるか',
        options: [adopt, keep],
        freeTextRequired: false,
        freeTextReason: null,
        recommended: CRITERIA_OPTION.adopt,
        recommendedReason: `調査の点検で ${review.findings.length} 件の指摘があり、書き直しの案はその指摘を解消するように作られています。`,
      };
  return [
    '```json:options',
    JSON.stringify({ kind: 'execution_continuation', questions: [question] }, null, 2),
    '```',
  ].join('\n');
}

/**
 * The question a person answers when the researcher proposes a rewrite.
 *
 * NOTE: When no criterion says what the person wants (task 1509,
 * 「使いやすくなっていること」), it asks for the purpose first, from the items
 * research could not settle, and shows the rewrite as the researcher's guess.
 * It used to present that guess as the answer to accept, which would build
 * features nobody asked for.
 *
 * @param title - Task title / タスク名
 * @param criteria - The criteria as they stand / 現在の受入条件
 * @param review - The researcher's review / 点検結果
 * @param openItems - Items under research.md's 未確定事項 / 調査で残った未確定事項
 * @returns question.md body / 質問の本文
 */
export function reviewQuestion(
  title: string,
  criteria: string[],
  review: CriteriaReview,
  openItems: string[] = [],
): string {
  const findings = review.findings.map((f) => {
    const which = f.index !== null && criteria[f.index] ? `「${criteria[f.index]}」` : '条件全体';
    return `- ${which}: ${KIND_JA[f.kind] ?? f.kind} — ${f.problem}`;
  });
  const unclear = purposeUnclear(criteria, review);
  if (unclear) {
    const questions = asks(openItems);
    return [
      '# 仕様確認: 何を良くしたいかの確認',
      '',
      `タスク「${title}」の完了条件からは、何を変えれば完了なのかが読み取れません。エージェントが目的を推測して作ると、頼んでいない変更になりかねないため、計画の前で止めています。`,
      '',
      '## 教えてほしいこと',
      ...(questions.length > 0
        ? questions.map((q) => `- ${q}`)
        : ['- 何に困っていて、どうなれば良いのか']),
      '',
      '## 指摘',
      ...findings,
      '',
      '## 書き直しの例（エージェントの推測）',
      '依頼にない内容を含むかもしれません。目的に合うものだけを使ってください。',
      ...review.proposed.map((p) => `- ${p}`),
      '',
      '何を良くしたいかを入力欄に書いて回答してください。タスクの詳細で目的と完了条件を書き換えてから回答しても構いません。回答すると、調査はやり直さずに計画から進みます。',
      '',
      optionsBlock(review, true),
    ].join('\n');
  }
  return [
    '# 仕様確認: 完了条件の見直しの提案',
    '',
    `タスク「${title}」を調査したところ、完了条件（エージェントが確かめる）に、差し戻しの原因になりそうな点がありました。計画は完了条件が決まってから作るため、ここで止めています。`,
    '',
    '## 指摘',
    ...findings,
    '',
    '## 書き直しの案',
    ...review.proposed.map((p) => `- ${p}`),
    '',
    '「推奨の完了条件に書き換える」を選ぶと、完了条件を上の案に書き換えます。いまの条件のままでよければ「今の完了条件のまま進める」を選んでください。どちらも、調査はやり直さずに計画から進みます。',
    '',
    optionsBlock(review, false),
  ].join('\n');
}
