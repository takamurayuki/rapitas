/**
 * criteria-review
 *
 * The completion-criteria review the researcher writes into research.md
 * (#1561): with the code in front of it, the researcher judges whether a
 * correct piece of work could be shown done against the acceptance criteria
 * — checkable in the working copy, consistent with the constraints and the
 * out of scope, enough to show the goals met, read only one way — and
 * proposes a rewrite when not. Done in research rather than as a separate
 * model call, because only someone who has read the code can tell whether a
 * named test exists or already fails, and because a confirmed rewrite then
 * needs no second research run.
 *
 * Holds the instruction, the finding kinds and the parser. Pure. Not
 * responsible for acting on a review (`research-criteria-review.ts`).
 */

/** What kind of problem a finding is — the unit the evidence is kept in. */
export const REVIEW_FINDING_KINDS = [
  'unverifiable', // the agent cannot check it in its working copy (CI, merge, production, a person)
  'contradiction', // conflicts with a constraint or with what is out of scope
  'insufficient', // met, the goals could still be unmet
  'ambiguous', // could be read two ways, so a reviewer may judge it either way
  'unrelated', // about something other than this task
] as const;

/** One of {@link REVIEW_FINDING_KINDS}. */
export type ReviewFindingKind = (typeof REVIEW_FINDING_KINDS)[number];

/** One problem with one criterion (or with the set, when index is null). */
export interface ReviewFinding {
  index: number | null;
  kind: ReviewFindingKind;
  problem: string;
}

/** The review's answer. */
export interface CriteriaReview {
  verdict: 'ok' | 'revise';
  findings: ReviewFinding[];
  /** The whole set rewritten, when the verdict is revise. */
  proposed: string[];
}

/** The fence label the researcher's machine-readable block carries. */
export const REVIEW_BLOCK_LABEL = 'criteria-review';

/** What the researcher is told to add to research.md (ja). */
export const RESEARCH_CRITERIA_REVIEW_JA = `## 完了条件の点検（必須）
調査の最後に、タスク情報の「明示された受入条件」を、読んだコードに照らして点検し、research.md に \`## 完了条件の点検\` として書いてください。エージェントは作業用コピーの中でファイルとローカルのコマンドだけを使って確かめます。CI の結果、マージ後、本番、人の操作は確かめられません。
- unverifiable: 作業用コピーの中で確かめられない（存在しないテストを名指ししている、変更前から落ちているテストを含む、なども）
- contradiction: 制約や範囲外と矛盾する
- insufficient: すべて満たしても、ゴールを満たしたとは言えない
- ambiguous: 読み方が二通りあり、判定が割れる
- unrelated: このタスクと関係がない
正しい作業が差し戻される、または誤った作業が通る原因になるものだけを指摘し、言い回しの好みは指摘しないでください。最後に次のブロックを必ず付けてください（index は受入条件の0始まりの番号、条件の組全体なら null）。見直しが必要なら proposed に受入条件の全体の書き直しを、確認方法を添えて入れてください。問題がなければ verdict を "ok"、proposed を空にしてください。
\`\`\`json ${REVIEW_BLOCK_LABEL}
{"verdict":"ok"|"revise","findings":[{"index":0,"kind":"unverifiable","problem":"..."}],"proposed":["..."]}
\`\`\``;

/** What the researcher is told to add to research.md (en). */
export const RESEARCH_CRITERIA_REVIEW_EN = `## Completion criteria review (required)
At the end of research, check the task's explicit acceptance criteria against the code you read and write a \`## 完了条件の点検\` section in research.md. The agent verifies only with files and local commands in its working copy; it cannot see CI results, post-merge state, production or a person's action.
- unverifiable: cannot be checked in the working copy (including naming a test that does not exist, or one that already fails before the change)
- contradiction: conflicts with a constraint or with what is out of scope
- insufficient: all met, the goals could still be unmet
- ambiguous: can be read two ways, so a verdict may go either way
- unrelated: not about this task
Flag only what would send correct work back or let wrong work pass, not wording preferences. End with this block (index is the 0-based criterion number, null for the set as a whole). When a revision is needed, put the whole rewritten set, each with how to check it, in proposed; otherwise verdict "ok" and an empty proposed.
\`\`\`json ${REVIEW_BLOCK_LABEL}
{"verdict":"ok"|"revise","findings":[{"index":0,"kind":"unverifiable","problem":"..."}],"proposed":["..."]}
\`\`\``;

/**
 * The review in a JSON text, or null when it cannot be read as one.
 *
 * @param text - Text holding the JSON object / JSON を含む文字列
 * @param count - How many criteria were reviewed / 点検した条件の数
 * @returns The review, or null / 点検結果
 */
export function parseCriteriaReview(text: string, count: number): CriteriaReview | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: { verdict?: unknown; findings?: unknown; proposed?: unknown };
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (raw.verdict !== 'ok' && raw.verdict !== 'revise') return null;
  const findings: ReviewFinding[] = (Array.isArray(raw.findings) ? raw.findings : []).flatMap(
    (f): ReviewFinding[] => {
      const o = f as { index?: unknown; kind?: unknown; problem?: unknown };
      if (!(REVIEW_FINDING_KINDS as readonly unknown[]).includes(o.kind)) return [];
      if (typeof o.problem !== 'string' || !o.problem.trim()) return [];
      const index =
        typeof o.index === 'number' && Number.isInteger(o.index) && o.index >= 0 && o.index < count
          ? o.index
          : null;
      return [{ index, kind: o.kind as ReviewFindingKind, problem: o.problem.trim() }];
    },
  );
  const proposed = (Array.isArray(raw.proposed) ? raw.proposed : [])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
  // A "revise" with nothing to say, or with no rewrite to offer, cannot be
  // acted on; treat it as no finding rather than stopping the task for it.
  if (raw.verdict === 'revise' && (findings.length === 0 || proposed.length === 0)) {
    return { verdict: 'ok', findings: [], proposed: [] };
  }
  return { verdict: raw.verdict, findings, proposed: raw.verdict === 'revise' ? proposed : [] };
}

/**
 * The researcher's review block in research.md, or null when there is none.
 *
 * @param researchMd - research.md / 調査結果
 * @param count - How many acceptance criteria the task has / 受入条件の数
 * @returns The review, or null / 点検結果
 */
export function extractResearchCriteriaReview(
  researchMd: string,
  count: number,
): CriteriaReview | null {
  const fence = new RegExp(
    '```json[ \\t]+' + REVIEW_BLOCK_LABEL + '[^\\n]*\\n([\\s\\S]*?)```',
    'i',
  );
  const m = researchMd.match(fence);
  return m ? parseCriteriaReview(m[1], count) : null;
}
