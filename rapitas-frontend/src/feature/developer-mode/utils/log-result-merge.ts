/**
 * log-result-merge
 *
 * Folds the successful `[Result: …]` lines of one run into a single line so
 * the log shows 「実行完了」 once per run. Not responsible for classifying or
 * rendering the line; lifecycle-patterns turns the merged line into the entry.
 */

const SUCCESS_RESULT = /^\[Result:\s*(completed|success)(?:\s*\(([\d.]+)s\))?(\s*\$[\d.]+)?\]/;

// Every agent runner opens a run with this banner; a log round can hold
// several runs (repairs, jurors), and each keeps its own completion.
const RUN_START = /\bStarting execution\b/;

/**
 * Merges the success result lines of one run (no run-start banner inside).
 *
 * @param lines - Lines of a single run / 1回分の実行のログ行
 * @returns Lines with at most one success result / 成功結果を1行以下にした行
 */
function mergeWithinRun(lines: string[]): string[] {
  let lastIndex = -1;
  let count = 0;
  let totalSeconds = 0;
  let anyDuration = false;
  lines.forEach((line, i) => {
    const m = SUCCESS_RESULT.exec(line);
    if (!m) return;
    lastIndex = i;
    count += 1;
    if (m[2]) {
      totalSeconds += Number(m[2]);
      anyDuration = true;
    }
  });
  if (count < 2) return lines;
  const duration = anyDuration ? ` (${totalSeconds.toFixed(1)}s)` : '';
  return lines.flatMap((line, i) => {
    if (!SUCCESS_RESULT.test(line)) return [line];
    return i === lastIndex ? [`[Result: completed${duration}]`] : [];
  });
}

/**
 * Keeps one successful result line per run, at the last one's position, with
 * the summed duration.
 *
 * NOTE: A CLI run that finished can be woken again by background task
 * notifications; every wake-up ends with its own result line (2026-11-26: four
 * 「実行完了」 for one implementer run). Summing keeps the total honest.
 * Failed results are left untouched so a failure is never hidden.
 *
 * @param lines - Log lines in order / 順序どおりのログ行
 * @returns Lines with one success result per run / 実行ごとに成功結果を1行にまとめた行
 */
export function mergeSuccessResults(lines: string[]): string[] {
  const runs: string[][] = [[]];
  for (const line of lines) {
    if (RUN_START.test(line) && runs[runs.length - 1].length > 0) runs.push([]);
    runs[runs.length - 1].push(line);
  }
  return runs.flatMap(mergeWithinRun);
}
