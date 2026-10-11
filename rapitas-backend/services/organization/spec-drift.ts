/**
 * spec-drift
 *
 * Detects where a generated project's requirements.md has fallen out of step
 * with what was actually filed and built, and turns that into one follow-up
 * task.
 * Deliberately limited to drift that is decidable from the document plus the
 * theme's task titles — it never edits the document and never guesses intent.
 */

import { ASSUMPTIONS_SECTION } from './spec-consistency';
import { FEATURE_BULLET, sectionLines } from './requirements-task-plan';

/** One way the document and the work have diverged. */
export interface SpecDriftFinding {
  /** Stable identifier, for tests and grouping. / 安定ID */
  code: string;
  /** Actionable Japanese description. / 対処できる日本語の説明 */
  message: string;
  /** The feature this concerns, when it concerns one. / 該当機能ID */
  featureId?: string;
}

/** Title prefix of the follow-up task, used for idempotency. */
export const DRIFT_TASK_PREFIX = '[DOC]';

/** `[F-NN]` as it appears at the start of a filed task's title. */
const TITLE_FEATURE_LABEL = /^\s*[[［]\s*(F-\d+)\s*[\]］]/;

/** Feature ids the requirements document declares. */
function documentedFeatureIds(requirements: string): Set<string> {
  const out = new Set<string>();
  for (const line of sectionLines(requirements, '機能要件')) {
    const id = line.match(FEATURE_BULLET)?.[1];
    if (id) out.add(id);
  }
  return out;
}

/** Feature ids that already have a task, read from the titles. */
function filedFeatureIds(titles: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const title of titles) {
    const id = title.match(TITLE_FEATURE_LABEL)?.[1];
    if (id) out.add(id);
  }
  return out;
}

/** Non-empty bullet/table rows in the assumptions section. */
function assumptionRows(requirements: string): string[] {
  return (
    sectionLines(requirements, ASSUMPTIONS_SECTION)
      .map((l) => l.trim())
      // Markdown table header and separator rows carry no assumption.
      .filter((l) => l.length > 0 && !/^\|?\s*-{3,}/.test(l) && !/^\|\s*#\s*\|/.test(l))
  );
}

/**
 * Compare the document against the work that exists.
 *
 * NOTE: Why this exists — the documents are written once at scaffold time and
 * committed, and nothing updates them afterwards. Decisions made during
 * implementation therefore live only in the code: measured 2026-10-11, task
 * 1185 settled TempoRaid's room-capacity semantics (an atomic Lua check) and
 * requirements.md still describes only "4人まで". The next reader, human or
 * agent, is handed a document that no longer matches the system.
 *
 * @param input - The document and the theme's task titles / 文書とタスク名一覧
 * @returns Findings, or [] when the document is in step / 乖離が無ければ []
 */
export function detectSpecDrift(input: {
  requirements: string;
  existingTitles: readonly string[];
}): SpecDriftFinding[] {
  const documented = documentedFeatureIds(input.requirements);
  if (documented.size === 0) return [];

  const filed = filedFeatureIds(input.existingTitles);
  const findings: SpecDriftFinding[] = [];

  // A task exists for a feature the document no longer declares: the feature
  // was removed or renumbered after it was filed, so the work and the spec now
  // disagree about what the product contains.
  for (const id of filed) {
    if (!documented.has(id)) {
      findings.push({
        code: 'undocumented_feature',
        featureId: id,
        message:
          `[${id}] のタスクは存在しますが、requirements.md の機能要件に [${id}] がありません。` +
          '文書から削除・改番されたか、文書化されないまま実装されています。',
      });
    }
  }

  // Every feature has been filed, yet unknowns are still listed: implementation
  // necessarily settled them, and whatever it settled them to is now undocumented.
  const allFiled = [...documented].every((id) => filed.has(id));
  const rows = assumptionRows(input.requirements);
  if (allFiled && rows.length > 0) {
    findings.push({
      code: 'unsettled_assumptions_after_build',
      message:
        `全 ${documented.size} 機能のタスクが起票済みですが、「${ASSUMPTIONS_SECTION}」に ` +
        `${rows.length} 件の未決事項が残っています。実装はこれらを何らかの値で確定させているため、` +
        '実際に採用された値を文書へ反映してください。',
    });
  }

  return findings;
}

/** The follow-up task, shaped like the ones the filer creates. */
export interface DriftTaskPayload {
  title: string;
  description: string;
  themeId: number;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

/**
 * Turn drift findings into one follow-up task.
 *
 * One task rather than one per finding: they are all the same job — read the
 * code, write down what it actually does — and N tasks would compete for the
 * single auto-run slot.
 *
 * @param findings - Result of detectSpecDrift / 検出結果
 * @param options - Theme the task belongs to / 所属テーマ
 * @returns The payload, or null when there is nothing to fix / 乖離が無ければ null
 */
export function toDriftTaskPayload(
  findings: readonly SpecDriftFinding[],
  options: { themeId: number },
): DriftTaskPayload | null {
  if (findings.length === 0) return null;

  const list = findings.map((f, i) => `${i + 1}. ${f.message}`).join('\n');
  return {
    title: `${DRIFT_TASK_PREFIX} requirements.md を実装の実態に合わせる`,
    description:
      'requirements.md は scaffold 時に書かれて初回コミットに入り、以降は更新されない。' +
      '実装中に決まった仕様はコードにしか存在せず、次に読む人（人間でもエージェントでも）は' +
      '実態と合わない文書を渡される。\n\n検出された乖離:\n' +
      list +
      '\n\nコードを読んで、実際に採用されている仕様を文書へ書き戻すこと。',
    themeId: options.themeId,
    goals: [
      '検出された乖離について、実装が実際に採用している仕様をコードから特定する',
      'requirements.md を実態に合わせて更新する',
    ],
    constraints: [
      '実装を変更しない。これは文書を実態に合わせるタスクであり、実態を文書に合わせるタスクではない。' +
        '実装側に欠陥を見つけた場合は別タスクとして起票し、本タスクでは文書のみを変更する',
      '推測で書かない。ファイル:行を根拠として示せる事実だけを書く',
      `未決事項が解決済みなら「${ASSUMPTIONS_SECTION}」から削除し、` +
        '未解決のまま残るものは理由と決める人を明記して残す',
      '機能要件の [F-NN] 番号を振り直さない。既存タスクのタイトルと対応が取れなくなる',
    ],
    acceptanceCriteria: [
      'Given 更新後の requirements.md When 機能要件セクションを読む Then 既存タスクのタイトルにある [F-NN] のすべてが機能要件に存在する',
      `Given 更新後の requirements.md When 「${ASSUMPTIONS_SECTION}」を読む Then 残っている各行に未解決の理由と決める人が書かれている`,
      'Given 差分 When 変更ファイル一覧を見る Then docs/ 配下のみが変更されている（実装ファイルの変更が含まれていない）',
    ],
  };
}
