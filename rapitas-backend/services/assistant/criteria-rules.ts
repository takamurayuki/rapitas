/**
 * CriteriaRules
 *
 * The rules for writing a task's completion criteria (#1545), as checks on
 * the wording and as the text the prompts that write criteria are given.
 * Each rule is a way tasks kept failing:
 *
 * - a criterion the agent cannot reach (CI, after merge, production) makes
 *   the verifier honestly report "not verified", and verify repairs forever;
 * - a bare "does not …" is met by doing nothing;
 * - a criterion with no way to check it is judged by guesswork;
 * - a report-shaped task with no "nothing to change" ending stops at the
 *   no-diff gate even when the report is right.
 *
 * Heuristics that advise; nothing here blocks a task. Pure. Not responsible
 * for vague words (`criteria-wording.ts`) or for who checks a criterion.
 */
import type { CriterionVerifier } from './criteria-wording';

/** Which rule a criterion breaks. */
export type CriterionIssueCode =
  | 'unreachable'
  | 'whole_suite'
  | 'negation_only'
  | 'no_check_method';

/** Which rule a task's spec as a whole breaks. */
export type SpecIssueCode = 'no_unchanged_route';

/** One broken rule, with how to rewrite. Messages are Japanese, for the card. */
export interface CriterionIssue {
  code: CriterionIssueCode | SpecIssueCode;
  /** What is wrong, in one sentence. / 何が問題か */
  message: string;
  /** How to say it so the rule holds. / 言い換えの案 */
  suggestion: string;
}

/**
 * What an agent at work cannot observe: results that exist only after a push
 * or a merge, and the state of production. Checked before anything else, as
 * the most expensive failure (verify_repair loops until it gives up).
 */
const UNREACHABLE =
  /(?:\bCI\b|GitHub\s*Actions|ワークフロー(?:が|の実行)|マージ(?:され|後|した後)|merged|本番|プロダクション|production|デプロイ(?:後|され)|リリース後|push\s*後|プッシュ後|レビュー(?:で|が)承認)/i;

/**
 * "All the tests pass": a whole suite or test file asked to pass. In the
 * #1545 trial (task #1498) 12 tests of the named file already failed on
 * Windows before the change, so the criterion could not be met however the
 * work was done.
 */
const WHOLE_SUITE =
  /(?:テスト|test|spec).{0,40}(?:すべて|全て|全件|全部|ぜんぶ|all).{0,6}(?:成功|通る|通過|パス|pass|green)|(?:すべて|全て|全件|全部)の(?:テスト|test)|全(?:テスト|test)/i;

/** Wording that compares with the state before the change, or names only the new tests. */
const BASELINE_RELATIVE = /変更前|ベース|baseline|新しく(?:足|追加)|追加した|足した/i;

/** A sentence that ends on a negation: "…しないこと", "…が出ない". */
const NEGATION_END =
  /(?:しない|させない|されない|出ない|ない|壊さない|なくなる|禁止)(?:こと)?[。.]?\s*$/;

/**
 * Words that say what happens instead, so a "does not" is paired with an
 * observable result ("…せず、…と表示する").
 */
const POSITIVE_CLAUSE = /(?:せず|ではなく|代わりに|かわりに|ずに)[、,]?/;

/**
 * Anything that says how the criterion is checked: a test, a command, a file
 * or path, an API call, an explicit 確認方法, or a measured result (a count,
 * a size, a time, a status code).
 */
const CHECK_METHOD = new RegExp(
  [
    String.raw`確認方法|確認:|確認：`,
    String.raw`テスト|\btest\b|vitest|bun\s+test|cargo|tsc|eslint|lint|prettier`,
    String.raw`` + '`',
    String.raw`[\w.-]+\/[\w./-]+`,
    String.raw`\b[\w-]+\.(?:ts|tsx|js|cjs|mjs|json|md|css|rs|py|dart|prisma|yml|yaml)\b`,
    String.raw`\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/`,
    String.raw`\d+\s*(?:件|個|px|秒|ms|%|行|回|ステータス)|ステータス\s*\d{3}|\b[1-5]\d\d\b`,
  ].join('|'),
  'i',
);

/** Titles and descriptions that make the deliverable a report, not a change. */
const REPORT_SHAPED = /調査|監査|棚卸|洗い出|分析|レポート|報告|診断|点検|audit|investigat/i;

// NOTE: The deliverable decides when it is chosen; the keywords are only the
// fallback. Trial #1499: 「点検」 in a PR task's title asked it for a report's
// ending.
function isReportShaped(deliverable: string | null | undefined, subject: string): boolean {
  if (deliverable === 'report' || deliverable === 'decision') return true;
  if (deliverable === 'pr' || deliverable === 'note') return false;
  return REPORT_SHAPED.test(subject);
}

/** The ending a report-shaped task needs when nothing turns out to need changing. */
const UNCHANGED_ROUTE = /変更不要|修正不要|変更なし|対応不要|no\s+change/i;

/**
 * The rules, as the prompts that write criteria state them. Kept beside the
 * checks so the two cannot drift: what a draft is told to do is what it is
 * then checked for.
 */
export const CRITERIA_RULES_PROMPT = `受け入れ条件（acceptanceCriteria）の書き方:
- 1件ごとに確認方法を添える。テスト名・コマンド・ファイル・API・数値のどれかで、作業者が自分で確かめられる形にする（例:「GET /tasks?q=abc が該当タスクだけを返す（確認方法: tasks.test.ts）」）。
- 作業中の担当者が確かめられないことは書かない。CI の結果、PR のマージ後、本番やデプロイ後の状態、人の操作は受け入れ条件にしない。必要なら「確認してほしいことを verify.md に書く」のように、作業者の成果物に言い換える。
- 既存のテストファイルやテスト全体が「すべて通る」ことを条件にしない。変更前から落ちているテストまで背負うことになる。「変更したファイルのテストと、変更したファイルを直接 import しているテストファイルが通る。比較は、そのうち変更前からあるテストファイルを変更前のコードで1回だけ実行して行い、ディレクトリ全体やスイート全体は実行しない（変更前から落ちているテストは件数と原因を verify.md に書く）」と、範囲を絞って変更前と比べる形で書く。
- 「〜しない」「〜が出ない」だけで終わる条件は書かない。何もしなくても満たせてしまうので、代わりに何がどうなるかを書く（例:「エラーは出さず、『タスクはありません』と表示する」）。
- 調査・監査・報告が成果物のタスクには、「直す必要がなければ、変更不要とその根拠を書いて完了とする」という条件を必ず入れる。
- 見た目の好みや使い心地など、人にしか判断できないことは受け入れ条件ではなく、本人が確かめる項目に分ける。`;

/**
 * The rules one criterion breaks.
 *
 * Only for criteria an agent is to check: the person's own checks
 * (`userAcceptanceChecks`) are judged by looking and using, so none of these
 * rules apply to them.
 *
 * @param text - One criterion / 受け入れ条件1件
 * @param verifier - Who checks it / 確認する人
 * @returns The rules it breaks, most expensive first / 該当する問題
 */
export function findCriterionIssues(text: string, verifier: CriterionVerifier): CriterionIssue[] {
  if (verifier === 'user') return [];
  const issues: CriterionIssue[] = [];
  if (UNREACHABLE.test(text)) {
    issues.push({
      code: 'unreachable',
      message: 'CI・マージ後・本番の状態は、作業中には確かめられません。',
      suggestion:
        'ローカルで確かめられる条件（該当テストが通る、など）に言い換えるか、確認してほしいことを verify.md に書く条件にしてください。',
    });
  }
  if (WHOLE_SUITE.test(text) && !BASELINE_RELATIVE.test(text)) {
    issues.push({
      code: 'whole_suite',
      message:
        '既存のテスト全体の成功を求めると、変更前から落ちているテストまで直さないと満たせません。',
      suggestion:
        '「変更したファイルのテストと、変更したファイルを直接 import しているテストファイルが通る。比較は、そのうち変更前からあるテストファイルを変更前のコードで1回だけ実行して行い、ディレクトリ全体やスイート全体は実行しない」と、範囲を絞って変更前と比べる形で書いてください。',
    });
  }
  if (NEGATION_END.test(text) && !POSITIVE_CLAUSE.test(text)) {
    issues.push({
      code: 'negation_only',
      message: '「〜しない」だけの条件は、何もしなくても満たせてしまいます。',
      suggestion: '代わりに何がどうなるかを書いてください（例:「〜は出さず、〜と表示する」）。',
    });
  }
  if (!CHECK_METHOD.test(text)) {
    issues.push({
      code: 'no_check_method',
      message: 'どうやって確かめるかが書かれていません。',
      suggestion: 'テスト名・コマンド・ファイル・API・数値のどれかで、確認方法を添えてください。',
    });
  }
  return issues;
}

/** What {@link findSpecIssues} reads. */
export interface SpecIssueInput {
  title: string;
  description: string | null;
  acceptanceCriteria: readonly string[];
  /** The task's deliverable (pr / note / report / decision), when chosen. */
  deliverable?: string | null;
}

/**
 * The rules a task's spec breaks as a whole.
 *
 * @param spec - Title, description and criteria / タスクの仕様
 * @returns The rules it breaks / 該当する問題
 */
export function findSpecIssues(spec: SpecIssueInput): CriterionIssue[] {
  const issues: CriterionIssue[] = [];
  const subject = `${spec.title}\n${spec.description ?? ''}`;
  const criteria = spec.acceptanceCriteria.join('\n');
  if (
    isReportShaped(spec.deliverable, subject) &&
    !UNCHANGED_ROUTE.test(`${criteria}\n${spec.description ?? ''}`)
  ) {
    issues.push({
      code: 'no_unchanged_route',
      message: '調査や報告のタスクに、直す必要がなかった場合の終わり方が書かれていません。',
      suggestion:
        '「直す必要がなければ、変更不要とその根拠を書いて完了とする」という条件を足してください。',
    });
  }
  return issues;
}
