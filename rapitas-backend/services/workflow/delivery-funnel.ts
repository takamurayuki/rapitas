/**
 * delivery-funnel
 *
 * Pure counts of how far a theme's work got: documented -> filed -> started ->
 * verified -> merged. Not responsible for DB access or for parsing requirements
 * documents — callers pass the task rows and, when they have it, the list of
 * feature ids the document declares.
 *
 * Why the document side is an input rather than a query: the "N features in the
 * requirements document" stage has no table. It lives in the document text in
 * the generated project's repo, so only a caller that read that file can supply
 * it (requirements-task-plan's matchFeatureLine is the parser). Measured
 * 2026-10-14: 652 of 748 tasks carry a goals field, but nothing stores the
 * document's feature list.
 *
 * Why `merged` is the last counted stage and NOT called success. Measured on
 * TempoRaid: 12 feature tasks, all done, 12 PRs merged — and the A6 audit found
 * 11 of those 12 unreachable from the shipped app (four .tsx files in total,
 * with game/scene.ts a 29-line empty three.js scaffold). A funnel that ended at
 * "merged" and called it delivered would have reported 12/12 for an app that
 * renders one audio panel. Runtime verification is the stage that would settle
 * it, and no table records its result, so this reports it as unknown rather
 * than assuming either way.
 */

/** One Task row, as the caller fetched it. */
export interface FunnelTask {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  githubPrId: number | null;
}

/** What the funnel found. */
export interface DeliveryFunnel {
  /** Features the requirements document declares, or null when not supplied. / 文書側の機能数 */
  documented: number | null;
  filed: number;
  started: number;
  verified: number;
  merged: number;
  /**
   * Deliberately null: no table records whether the app was actually run. See
   * the module note — `merged` is not evidence of working software.
   */
  runtimeVerified: null;
  /** Distinct documented features that have at least one task. / 起票済みの機能ID */
  filedFeatures: string[];
  /** Feature ids filed but absent from the document — a spec/task mismatch. / 文書に無い機能ID */
  undocumentedFeatures: string[];
  filedPerDocumented: number | null;
  mergedPerFiled: number | null;
  caveat: string;
}

/** Task titles declare a feature as `[F-02] …`; a bare mention is not a declaration. */
const FEATURE_IN_TITLE = /[[［]\s*(F-\d+)\s*[\]］]/;

/** Statuses that end a task without delivering it. */
const ABANDONED = new Set(['cancelled']);

/** Statuses that mean the work finished. */
const TERMINAL = new Set(['done', 'completed']);

const CAVEAT =
  'merged counts PRs, not working software: runtime verification is not recorded anywhere, ' +
  'so runtimeVerified is unknown. TempoRaid had 12/12 features merged with 11 unreachable ' +
  'from the shipped app.';

/** Ratio, or null when the denominator is zero. */
function ratio(numerator: number, denominator: number | null): number | null {
  return denominator !== null && denominator > 0 ? numerator / denominator : null;
}

/**
 * Count a theme's work at each stage.
 *
 * A cancelled task is counted as filed but never beyond it: it was asked for and
 * abandoned, and letting it advance would make abandonment look like progress.
 * `done`/`completed` count as verified regardless of workflowStatus, because a
 * terminal task has been through the gate whatever its last workflow row says.
 *
 * @param input.tasks - The theme's tasks / テーマのタスク
 * @param input.documentedFeatures - Feature ids the document declares / 文書の機能ID
 * @returns Stage counts and the two yields / 各段の件数と歩留まり
 */
export function computeDeliveryFunnel(input: {
  tasks: readonly FunnelTask[];
  documentedFeatures?: readonly string[];
}): DeliveryFunnel {
  const { tasks } = input;
  const documentedSet = input.documentedFeatures
    ? new Set(input.documentedFeatures.map((f) => f.toUpperCase()))
    : null;

  let started = 0;
  let verified = 0;
  let merged = 0;
  const filedFeatures = new Set<string>();
  const undocumented = new Set<string>();

  for (const task of tasks) {
    const abandoned = ABANDONED.has(task.status);
    const terminal = TERMINAL.has(task.status);
    if (!abandoned) {
      if (terminal || (task.workflowStatus !== null && task.workflowStatus !== 'draft')) started++;
      if (terminal || task.workflowStatus === 'verify_done') verified++;
      if (task.githubPrId !== null) merged++;
    }

    const match = FEATURE_IN_TITLE.exec(task.title);
    if (!match) continue;
    const feature = match[1].toUpperCase();
    if (documentedSet === null || documentedSet.has(feature)) filedFeatures.add(feature);
    else undocumented.add(feature);
  }

  const documented = documentedSet ? documentedSet.size : null;
  return {
    documented,
    filed: tasks.length,
    started,
    verified,
    merged,
    runtimeVerified: null,
    filedFeatures: [...filedFeatures].sort(),
    undocumentedFeatures: [...undocumented].sort(),
    // Only documented features count toward this yield, so a task filed for a
    // feature the document never declared cannot push it above 1.
    filedPerDocumented: ratio(filedFeatures.size, documented),
    mergedPerFiled: ratio(merged, tasks.length),
    caveat: CAVEAT,
  };
}
