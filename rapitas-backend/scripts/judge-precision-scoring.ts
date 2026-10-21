/**
 * judge-precision-scoring
 *
 * Pure scoring for the adversarial judge's precision: diff ablation, per-arm
 * tallies, and the interval around them. Makes no model calls and reads no
 * files — the live harness is scripts/judge-precision.ts.
 *
 * Why two arms. Asking the judge to re-score diffs that shipped measures only
 * one half of the gate: whether it blocks work it should wave through. A gate
 * must also be shown to FAIL, so the same diffs are asked again with one
 * implementing file removed — a plan item that is now genuinely missing. A
 * judge that scores well on one arm and badly on the other is not accurate,
 * it is biased, and only reporting both can tell the difference.
 */
import { generatedArtifactReason } from '../services/agents/verification/generated-artifact-paths';

/** Which version of a diff the judge was shown. */
export type Arm = 'clean' | 'ablated';

/** One changed file, as the jury diff builder consumes it. */
export interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
}

/** One judge call's outcome. */
export interface JudgeRun {
  verdict: 'pass' | 'fail' | 'unknown';
  /** Whether a fail named the file the ablation removed. */
  citedRemoved: boolean;
}

/** Every run of one case within one arm. */
export interface CaseRuns {
  caseId: string;
  runs: JudgeRun[];
}

/** What one arm's runs add up to. */
export interface ArmReport {
  arm: Arm;
  cases: number;
  /** Cases asked more than once, i.e. those that can be inconsistent. */
  repeatedCases: number;
  /** Cases whose repeats did not all return the same verdict. */
  inconsistentCases: number;
  judgedRuns: number;
  unknownRuns: number;
  correctRuns: number;
  wrongRuns: number;
  /** Fails on a shipped diff / passes on an ablated one, over judged runs. */
  wrongRate: number;
  wrongRateCI: [number, number];
  /** Fails that named the removed file (ablated arm only). */
  citedRemovedRuns: number;
}

/** The verdict that is wrong for this arm. */
const wrongVerdict = (arm: Arm): 'pass' | 'fail' => (arm === 'clean' ? 'fail' : 'pass');

/**
 * Remove the one file that carries the most new implementation code.
 *
 * Tests are left in place: a diff missing its test is caught by the coverage
 * gate without any model, and this arm exists to ask whether the judge
 * notices missing IMPLEMENTATION. Generated artifacts are left too — losing
 * regenerated output does not make a diff incomplete, so a pass there would
 * be correct and would only dilute the measurement.
 *
 * @param files - The diff as merged / マージ時点の差分
 * @returns The reduced diff and the file removed (null when none qualifies) / 削った差分と削除ファイル
 */
export function ablateStructuredDiff(files: DiffFile[]): {
  files: DiffFile[];
  removed: string | null;
} {
  const eligible = files.filter(
    (f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f.filename) && !generatedArtifactReason(f.filename),
  );
  // Removing the only source file leaves a diff the completion gate rejects
  // before a judge is ever asked, so there would be nothing to measure.
  if (eligible.length === 0 || files.length < 2) return { files, removed: null };
  const target = eligible.reduce((a, b) => (b.additions > a.additions ? b : a));
  return { files: files.filter((f) => f.filename !== target.filename), removed: target.filename };
}

/**
 * Split `git diff` output into one entry per changed file.
 *
 * Only the real content lines are counted: the `---`/`+++` headers start with
 * the same characters as removals and additions, and counting them would add
 * one to every file in each direction — enough to pick the wrong ablation
 * target between two similar files.
 *
 * @param text - Raw unified diff / git diff の生出力
 * @returns One entry per file, patch included / ファイルごとのエントリ
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  if (!text.trim()) return [];
  const out: DiffFile[] = [];
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n');
    const header = lines[0] ?? '';
    const m = /^a\/(.+?) b\/(.+)$/.exec(header.trim());
    const filename = m ? m[2] : header.trim();
    let additions = 0;
    let deletions = 0;
    const patch: string[] = [];
    let inHunk = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) inHunk = true;
      if (!inHunk) continue;
      patch.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    const status = /^new file mode/m.test(chunk)
      ? 'added'
      : /^deleted file mode/m.test(chunk)
        ? 'removed'
        : 'modified';
    out.push({ filename, status, additions, deletions, patch: patch.join('\n') });
  }
  return out;
}

/**
 * Percentile interval by resampling CASES.
 *
 * Cases are the independent unit: the repeats within one case share a diff and
 * a prompt, so resampling runs would report an interval several times too
 * narrow and make a noisy judge look settled.
 *
 * @param values - One value per case / ケースごとの値
 * @param reps - Resamples to draw / 再標本化の回数
 * @param seed - Seed, so a report is reproducible / 再現用シード
 * @returns The 2.5th and 97.5th percentiles / 2.5%点と97.5%点
 */
export function bootstrapInterval(values: number[], reps = 2000, seed = 12345): [number, number] {
  if (values.length === 0) return [0, 0];
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(next() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.floor(q * means.length))];
  return [at(0.025), at(0.975)];
}

/**
 * Tally one arm's runs.
 *
 * @param arm - Which diff the runs scored / 採点対象の差分
 * @param cases - Runs grouped by case / ケース単位の実行
 * @returns The arm's report / 集計結果
 */
export function scoreArm(arm: Arm, cases: CaseRuns[]): ArmReport {
  const bad = wrongVerdict(arm);
  let judgedRuns = 0;
  let unknownRuns = 0;
  let wrongRuns = 0;
  let citedRemovedRuns = 0;
  let repeatedCases = 0;
  let inconsistentCases = 0;
  const perCase: number[] = [];

  for (const c of cases) {
    const judged = c.runs.filter((r) => r.verdict !== 'unknown');
    unknownRuns += c.runs.length - judged.length;
    judgedRuns += judged.length;
    const wrong = judged.filter((r) => r.verdict === bad).length;
    wrongRuns += wrong;
    citedRemovedRuns += c.runs.filter((r) => r.verdict === 'fail' && r.citedRemoved).length;
    if (c.runs.length > 1) {
      repeatedCases += 1;
      if (new Set(c.runs.map((r) => r.verdict)).size > 1) inconsistentCases += 1;
    }
    // A case with no judged run carries no information about accuracy; it
    // would otherwise enter the interval as a confident zero.
    if (judged.length > 0) perCase.push(wrong / judged.length);
  }

  return {
    arm,
    cases: cases.length,
    repeatedCases,
    inconsistentCases,
    judgedRuns,
    unknownRuns,
    correctRuns: judgedRuns - wrongRuns,
    wrongRuns,
    wrongRate: judgedRuns === 0 ? 0 : wrongRuns / judgedRuns,
    wrongRateCI: bootstrapInterval(perCase),
    citedRemovedRuns,
  };
}
