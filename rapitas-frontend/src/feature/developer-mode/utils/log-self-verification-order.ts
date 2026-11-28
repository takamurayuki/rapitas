/**
 * log-self-verification-order
 *
 * Keeps 「実行完了」 behind the self-verification verdict. In a run whose log
 * announced `[SelfVerification] waiting`, every `[Result: …]` line is held
 * back until each announced run has its `[SelfVerification] result` line,
 * then placed right after the last of them. Not responsible for classifying
 * or rendering the lines (lifecycle-patterns does that).
 */

const RESULT_LINE = /^\[Result:/;
const WAITING_LINE = /^\[SelfVerification\]\s+waiting\s+runId=(\S+)/;
const VERDICT_LINE = /^\[SelfVerification\]\s+result\s+runId=(\S+)/;

// Same run boundary as log-result-merge: every agent runner opens a run with this banner.
const RUN_START = /\bStarting execution\b/;

/**
 * Reorders one run's lines.
 *
 * @param lines - Lines of a single run / 1回分の実行のログ行
 * @returns Reordered lines / 並べ替えた行
 */
function orderWithinRun(lines: string[]): string[] {
  const waited = new Set<string>();
  const verdicts = new Set<string>();
  let lastVerdictIndex = -1;
  lines.forEach((line, i) => {
    const w = WAITING_LINE.exec(line.trim());
    if (w) waited.add(w[1]);
    const v = VERDICT_LINE.exec(line.trim());
    if (v) {
      verdicts.add(v[1]);
      lastVerdictIndex = i;
    }
  });
  if (waited.size === 0) return lines;

  const settled = [...waited].every((runId) => verdicts.has(runId));
  const results: string[] = [];
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (RESULT_LINE.test(line.trim())) {
      results.push(line);
    } else {
      out.push(line);
    }
    // NOTE: Without a verdict the completion stays hidden; the screen shows only the waiting line.
    if (settled && i === lastVerdictIndex) out.push(...results.splice(0));
  });
  if (settled) out.push(...results);
  return out;
}

/**
 * Places each run's completion line after its self-verification verdict.
 *
 * @param lines - Log lines in order / 順序どおりのログ行
 * @returns Lines with completion after the verdict; unchanged when no run waited
 *   / 自己検証の結果の後ろに完了行を置いた行（待ちが無ければそのまま）
 */
export function orderSelfVerificationResults(lines: string[]): string[] {
  if (!lines.some((line) => WAITING_LINE.test(line.trim()))) return lines;
  const runs: string[][] = [[]];
  for (const line of lines) {
    if (RUN_START.test(line) && runs[runs.length - 1].length > 0) runs.push([]);
    runs[runs.length - 1].push(line);
  }
  return runs.flatMap(orderWithinRun);
}
