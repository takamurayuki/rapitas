/**
 * phase-run-label
 *
 * Says what one run inside an execution-log round was, so the log pane can
 * label its divider. A diff-review juror run writes no log lines — only a
 * one-line JSON result in `output` — and showed up as an empty 「実行 2/3」.
 * Not responsible for grouping runs into rounds (phase-segmentation.ts).
 */

/** The juror's own result, read from its `output` line. Unknown fields are null. */
export interface PhaseRunReview {
  seatId: string | null;
  /** Model id without the provider prefix (`chatgpt:gpt-6-astra` → `gpt-6-astra`). */
  model: string | null;
  verdict: string | null;
  findings: number | null;
}

/** One run of a round. `review` is set only for a diff-review juror run. */
export interface PhaseRunLabel {
  executionId: number;
  review?: PhaseRunReview;
}

const REVIEW_COMMAND = 'adversarial-review';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Describe one execution of a round.
 *
 * @param e - The execution's id, command and output / 実行のID・コマンド・出力
 * @returns Its label data / 表示用の情報
 */
export function describePhaseRun(e: {
  id: number;
  command: string | null;
  output: string | null;
}): PhaseRunLabel {
  if (e.command !== REVIEW_COMMAND) return { executionId: e.id };
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(e.output ?? '');
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
  } catch {
    // An unreadable result still labels the run as a review; no verdict is made up.
  }
  const juror = str(parsed.juror);
  return {
    executionId: e.id,
    review: {
      seatId: str(parsed.seatId),
      model: juror ? juror.slice(juror.indexOf(':') + 1) : null,
      verdict: str(parsed.jurorVerdict),
      findings:
        typeof parsed.findings === 'number' && Number.isFinite(parsed.findings)
          ? parsed.findings
          : null,
    },
  };
}
