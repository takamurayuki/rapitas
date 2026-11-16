/**
 * CriteriaWording
 *
 * Reads one completion criterion's wording: who would check it (the jury from
 * the diff, or the person themselves) and whether it leans on a word nobody
 * can check, with a concrete rewording to offer (companion design 段B).
 * Heuristics for the confirmation card; the user decides. Pure.
 */

/**
 * Who is expected to check a criterion. Decides the column a confirmed
 * criterion is written to: 'jury' → `Task.acceptanceCriteria`, 'user' →
 * `Task.userAcceptanceChecks` (design 4.1 案1, approved 2026-11-12).
 */
export type CriterionVerifier = 'jury' | 'user';

/**
 * Words a person cannot check, with how to say them so they can be.
 *
 * Order matters: the first match is the one reported.
 */
const VAGUE_TERMS: ReadonlyArray<{ pattern: RegExp; term: string; suggestion: string }> = [
  {
    pattern: /使いやす|使い勝手/,
    term: '使いやすい',
    suggestion: '「◯タップ（◯手順）以内で〜できる」のように、操作の数で書く',
  },
  {
    pattern: /見やす|分かりやす|わかりやす/,
    term: '分かりやすい',
    suggestion: '「何を・どこに・どう表示するか」を書く（例：一覧の先頭に期限を表示する）',
  },
  {
    pattern: /速く|速い|高速|すばや|素早|サクサク|軽く/,
    term: '速い',
    suggestion: '「◯秒以内に終わる」のように、時間で書く',
  },
  {
    pattern: /適切|適宜|ちゃんと|しっかり|きちんと/,
    term: '適切に',
    suggestion: '何を満たせば「適切」なのかを、条件として書き出す',
  },
  {
    pattern: /きれい|綺麗|美しい/,
    term: 'きれい',
    suggestion: '揃える位置・色・余白など、見た目の基準を書く',
  },
  {
    pattern: /改善|向上|良くな|よくな/,
    term: '改善する',
    suggestion: '変更前と比べて「何が・どれだけ」変わるかを書く',
  },
  {
    pattern: /問題なく|正常に|うまく|いい感じ/,
    term: '問題なく',
    suggestion: '「どの操作で・どんな結果になるか」を書く',
  },
];

/** Phrasings that only the person can judge (seeing, using, being satisfied). */
const USER_VERIFIED =
  /本人|ユーザーが|自分で|自分が|見て|使って|試して|感じ|満足|納得|気に入|好み|読んで/;

/**
 * Who would check this criterion.
 *
 * A heuristic; the card shows it and the user can reword the criterion. For an
 * errand (a booking, a payment …) there is no diff for the jury to read, so
 * every criterion is the person's whatever its wording.
 *
 * @param text - One criterion / 完了条件1件
 * @param kind - The task's kind, when known / タスクの種類（分かる場合）
 * @returns 'user' for what only the person can check, otherwise 'jury' / 判定者
 */
export function classifyVerifier(
  text: string,
  kind?: 'software' | 'errand' | 'unknown',
): CriterionVerifier {
  if (kind === 'errand') return 'user';
  return USER_VERIFIED.test(text) ? 'user' : 'jury';
}

/**
 * The first vague term in a criterion, with a concrete rewording to consider.
 *
 * @param text - One criterion / 完了条件1件
 * @returns The term and the hint, or null / 曖昧な語と言い換えの案
 */
export function findVagueTerm(text: string): { term: string; suggestion: string } | null {
  for (const v of VAGUE_TERMS) {
    if (v.pattern.test(text)) return { term: v.term, suggestion: v.suggestion };
  }
  return null;
}
