/**
 * supervisor-incident-detectors
 *
 * Pure detection predicates for the four supervisor-discovered defect classes
 * (2026-08-15 converter incident): research ran against the wrong repository,
 * a success was recorded as a failure, an in-progress task was force-stopped
 * right after making progress, and a self-observation concern was filed under
 * the wrong theme. DB-independent by design — every input is a plain snapshot
 * assembled by supervisor-incident-evidence, so each detector is unit-testable
 * at its boundaries. NOT responsible for evidence gathering or concern filing.
 */

/** Window after a terminal failure mark in which a success artifact counts as a false failure (default 10m). */
export const FALSE_FAILURE_WINDOW_MS =
  parseInt(process.env.RAPITAS_INCIDENT_FALSE_FAILURE_WINDOW_MS ?? '', 10) || 10 * 60 * 1000;

/** Progress-to-backstop gap below which a hang-backstop force stop counts as false (default 60s). */
export const FORCESTOP_MIN_GAP_MS =
  parseInt(process.env.RAPITAS_INCIDENT_FORCESTOP_MIN_GAP_MS ?? '', 10) || 60 * 1000;

/** Minimum "no target" ratio in a verify checklist to flag theme misplacement (default 0.6). */
export const MISPLACEMENT_RATIO =
  parseFloat(process.env.RAPITAS_INCIDENT_MISPLACEMENT_RATIO ?? '') || 0.6;

/** Minimum verify checklist items required before misplacement is judged (default 3). */
export const MISPLACEMENT_MIN_ITEMS =
  parseInt(process.env.RAPITAS_INCIDENT_MISPLACEMENT_MIN_ITEMS ?? '', 10) || 3;

/**
 * Phrases that mark a verify checklist item as "no target code exists" — the
 * exact vocabulary task 587's verify used after being filed under the wrong
 * theme. Matched case-insensitively as substrings.
 */
export const NO_TARGET_PHRASES: readonly string[] = [
  '対象コードなし',
  '対象なし',
  '対象ファイルなし',
  '該当なし',
  '該当コードなし',
  '該当せず',
  '存在しない',
  '見つかりません',
  'n/a',
];

// NOTE: 由来 self-development-theme.normalizePath — copied instead of imported
// so this module stays DB-free (that module imports prisma at top level).
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Snapshot for the cwd/theme mismatch detector (defect class A). */
export interface CwdMismatchInput {
  /** cwd parsed from the latest execution's output head, null when absent. */
  executionCwd: string | null;
  /** The task's theme workingDirectory, null when unset. */
  themeWorkingDirectory: string | null;
}

/**
 * Detects an execution that ran outside its theme's working directory —
 * the "research investigated another repository" defect (task 580, fixed in
 * d22bdae0). Worktrees under `<themeDir>/.worktrees/` count as a match since
 * mutating roles legitimately run there.
 *
 * @param input - cwd + theme directory snapshot. / cwdとテーマディレクトリ
 * @returns The mismatched pair (original casing), or null. / 不一致ペアまたはnull
 */
export function detectCwdMismatch(
  input: CwdMismatchInput,
): { cwd: string; themeDir: string } | null {
  if (!input.executionCwd || !input.themeWorkingDirectory) return null;
  const cwd = normalizePath(input.executionCwd);
  const themeDir = normalizePath(input.themeWorkingDirectory);
  if (cwd === themeDir) return null;
  if (cwd.startsWith(`${themeDir}/.worktrees/`)) return null;
  return { cwd: input.executionCwd, themeDir: input.themeWorkingDirectory };
}

/** Snapshot for the false-failure detector (defect class B). */
export interface FalseFailureInput {
  /** Latest terminal failure mark for the task, epoch ms (null = none). */
  failureMarkedAtMs: number | null;
  /** Earliest success artifact (PR / auto_pr_created), epoch ms (null = none). */
  successArtifactAtMs: number | null;
  windowMs?: number;
}

/**
 * Detects a success artifact appearing shortly AFTER a terminal failure mark —
 * the "completion gate declared failure 57s before the PR landed" defect
 * (task 580 / PR #7, fixed in ef70a804). A success far outside the window is a
 * legitimate later retry, not a wrong verdict.
 *
 * @param input - Failure/success timestamps. / 失敗マークと成功時刻
 * @returns The gap in ms when inside the window, or null. / 窓内ならgapMs
 */
export function detectFalseFailure(input: FalseFailureInput): { gapMs: number } | null {
  if (input.failureMarkedAtMs === null || input.successArtifactAtMs === null) return null;
  const gapMs = input.successArtifactAtMs - input.failureMarkedAtMs;
  if (gapMs <= 0) return null;
  if (gapMs > (input.windowMs ?? FALSE_FAILURE_WINDOW_MS)) return null;
  return { gapMs };
}

/** Snapshot for the false force-stop detector (defect class C). */
export interface FalseForceStopInput {
  /** Latest auto_run_hang_backstop notification time, epoch ms (null = none). */
  backstopAtMs: number | null;
  /** Latest phase_completed:* transition at or before the backstop, epoch ms. */
  lastProgressAtMs: number | null;
  thresholdMs?: number;
}

/**
 * Detects a hang-backstop force stop that fired right after real progress —
 * the "implementer was killed 8s after committing" defect (task 585, fixed in
 * 28b5f5f5). A genuine hang has its last progress far before the backstop.
 *
 * @param input - Backstop/progress timestamps. / 強制停止と直近進捗の時刻
 * @returns The gap in ms when below the threshold, or null. / 閾値未満ならgapMs
 */
export function detectFalseForceStop(input: FalseForceStopInput): { gapMs: number } | null {
  if (input.backstopAtMs === null || input.lastProgressAtMs === null) return null;
  const gapMs = input.backstopAtMs - input.lastProgressAtMs;
  if (gapMs < 0) return null;
  if (gapMs >= (input.thresholdMs ?? FORCESTOP_MIN_GAP_MS)) return null;
  return { gapMs };
}

/** Aggregate of one verify checklist for the misplacement detector. */
export interface VerifyChecklistStats {
  /** Number of checklist items found. */
  total: number;
  /** Items whose text contains a NO_TARGET_PHRASES entry. */
  noTargetCount: number;
  /** Up to 3 matching item lines, for the concern's evidence section. */
  samples: string[];
}

/** Checklist item shapes verify.md uses: `- [ ]` / `- [x]` / `- ✅` / `- ❌` / `- ⚠️`. */
const CHECKLIST_ITEM = /^\s*-\s*(?:\[[ xX]\]|✅|❌|⚠️)\s*(.+)$/;

/**
 * Counts verify-checklist items and how many of them are "no target" verdicts.
 * Pure text analysis — the caller fetches the verify content.
 *
 * @param content - verify artifact Markdown, or null when absent. / verify本文
 * @returns Item totals + sample lines. / 集計とサンプル行
 */
export function analyzeVerifyChecklist(content: string | null): VerifyChecklistStats {
  const stats: VerifyChecklistStats = { total: 0, noTargetCount: 0, samples: [] };
  if (!content) return stats;
  for (const line of content.split(/\r?\n/)) {
    const match = CHECKLIST_ITEM.exec(line);
    if (!match) continue;
    stats.total++;
    const text = (match[1] ?? '').toLowerCase();
    if (NO_TARGET_PHRASES.some((phrase) => text.includes(phrase.toLowerCase()))) {
      stats.noTargetCount++;
      if (stats.samples.length < 3) stats.samples.push(line.trim());
    }
  }
  return stats;
}

/** Snapshot for the theme-misplacement detector (defect class D). */
export interface ThemeMisplacementInput {
  /** Total verify checklist items (0 = no verify / no checklist). */
  checklistTotal: number;
  /** Items judged "no target" (see NO_TARGET_PHRASES). */
  noTargetCount: number;
  minItems?: number;
  ratioThreshold?: number;
}

/**
 * Detects a verify checklist dominated by "no target code" verdicts — the
 * signature of a concern filed under the wrong theme, whose promoted task can
 * only report the target does not exist (task 587, fixed in 8ac37ec3). Small
 * checklists are skipped: below minItems the ratio is statistically unstable.
 *
 * @param input - Checklist aggregate + thresholds. / チェックリスト集計と閾値
 * @returns Totals + ratio when dominated, or null. / 過半検出時の集計またはnull
 */
export function detectThemeMisplacement(
  input: ThemeMisplacementInput,
): { total: number; noTargetCount: number; ratio: number } | null {
  const minItems = input.minItems ?? MISPLACEMENT_MIN_ITEMS;
  if (input.checklistTotal < minItems) return null;
  const ratio = input.noTargetCount / input.checklistTotal;
  if (ratio < (input.ratioThreshold ?? MISPLACEMENT_RATIO)) return null;
  return { total: input.checklistTotal, noTargetCount: input.noTargetCount, ratio };
}
