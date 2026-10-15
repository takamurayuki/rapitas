/**
 * pr-risk-comment
 *
 * Renders the PR-risk explanation comment (score, threshold, stage, SHAP
 * table, main factor, human-in-the-loop notice) and keeps exactly one such
 * comment per PR by PATCHing the marker comment instead of re-posting.
 */
import { COMMENT_MARKER, type PrRiskStage, type Prediction } from './pr-risk-types';
import type { GhRunner } from './pr-risk-features';

/** Organisational notice (requirement 5): the score never replaces human judgement. */
export const HUMAN_NOTICE =
  'このスコアは参考値です。最終判定は人間が行います。偽陽性・偽陰性があり得ます。';

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const signed = (v: number): string => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(3)}`;

/**
 * Build the Markdown comment body.
 *
 * @param p - prediction, threshold, stage and whether the merge was held / 表示内容
 * @returns Comment body starting with COMMENT_MARKER / コメント本文
 */
export function buildRiskComment(p: {
  prediction: Prediction;
  threshold: number;
  stage: PrRiskStage;
  held: boolean;
}): string {
  const { prediction } = p;
  const main = prediction.contributions[0];
  const rows = prediction.contributions.map((c) => `| ${c.feature} | ${signed(c.phi)} |`);
  return [
    COMMENT_MARKER,
    '### PR リスク予測（マージ後 72h 以内のロールバック / 本番重大障害）',
    '',
    `- スコア: **${pct(prediction.score)}**（threshold ${pct(p.threshold)} / 段階 \`${p.stage}\`）`,
    ...(p.held
      ? ['- threshold 以上のため **自動マージを保留** しました。人間が確認してマージしてください。']
      : []),
    main ? `- 主因: ${main.feature}（φ = ${signed(main.phi)}）` : '- 主因: なし',
    '',
    `SHAP 値（ロジット空間、ベース値 ${prediction.baseLogit.toFixed(3)} からの寄与。正はリスク増）`,
    '',
    '| 特徴量 | φ |',
    '| --- | --- |',
    ...rows,
    '',
    `> ${HUMAN_NOTICE}`,
  ].join('\n');
}

/**
 * Create or update the single risk comment on a PR.
 *
 * @param cwd - Repo working directory (gh resolves {owner}/{repo} from it) / 作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param body - Comment body / 本文
 * @param runGh - gh runner (DI) / gh 実行関数
 * @returns 'updated' when a marker comment existed, else 'created' / 実行種別
 */
export async function upsertRiskComment(
  cwd: string,
  prNumber: number,
  body: string,
  runGh: GhRunner,
): Promise<'created' | 'updated'> {
  // NOTE: No --paginate — gh concatenates page arrays ("[..][..]") which is not
  // valid JSON. 100 comments covers agent PRs; the marker is posted early.
  const listed = await runGh(
    ['api', `repos/{owner}/{repo}/issues/${prNumber}/comments?per_page=100`],
    cwd,
  );
  const comments = JSON.parse(listed || '[]') as Array<{ id: number; body?: string }>;
  const existing = comments.find(
    (c) => typeof c.body === 'string' && c.body.startsWith(COMMENT_MARKER),
  );
  if (existing) {
    await runGh(
      [
        'api',
        '--method',
        'PATCH',
        `repos/{owner}/{repo}/issues/comments/${existing.id}`,
        '-f',
        `body=${body}`,
      ],
      cwd,
    );
    return 'updated';
  }
  await runGh(
    [
      'api',
      '--method',
      'POST',
      `repos/{owner}/{repo}/issues/${prNumber}/comments`,
      '-f',
      `body=${body}`,
    ],
    cwd,
  );
  return 'created';
}
