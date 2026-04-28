/**
 * log-summary-generator
 *
 * Extracts structured metrics from a raw log array: files touched, test
 * results, commits, errors, duration, and cost.
 * Also provides phase detection for the workflow progress indicator.
 */

import { splitLogsIntoLines } from './log-transformers';
import type { ExecutionSummary } from './log-pattern-rules';

export type { ExecutionSummary } from './log-pattern-rules';

/**
 * Detect the latest workflow phase present in the given log lines.
 *
 * @param logs - raw log entries / 生ログ配列
 * @returns detected phase or null / 検出されたフェーズまたは null
 */
export function detectCurrentPhase(
  logs: string[],
): 'research' | 'plan' | 'implement' | 'verify' | null {
  const lines = splitLogsIntoLines(logs);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/\[verify\]/i.test(line)) return 'verify';
    if (/\[implement\]/i.test(line)) return 'implement';
    if (/\[plan\]/i.test(line)) return 'plan';
    if (/\[research\]/i.test(line)) return 'research';
  }
  return null;
}

/**
 * Scan a raw log array and produce an execution summary.
 * Returns null when no significant activity is detected (nothing to summarize).
 *
 * @param logs - raw log entries / 生ログ配列
 * @returns summary object or null / サマリーオブジェクトまたは null
 */
export function generateExecutionSummary(logs: string[]): ExecutionSummary | null {
  const lines = splitLogsIntoLines(logs);
  const filesEdited = new Set<string>();
  const filesCreated = new Set<string>();
  const filesRead = new Set<string>();
  let testsPassed = 0,
    testsFailed = 0,
    commits = 0;
  const errors: string[] = [];
  let durationSeconds: number | undefined, costUsd: number | undefined;

  for (const line of lines) {
    const t = line.trim();

    const em = t.match(/\[Tool: Edit\]\s*->\s*(\S+)/);
    if (em?.[1]) filesEdited.add(em[1]);

    const wm = t.match(/\[Tool: Write\]\s*->\s*(\S+)/);
    if (wm?.[1]) filesCreated.add(wm[1]);

    const rm = t.match(/\[Tool: Read\]\s*->\s*(\S+)/);
    if (rm?.[1]) filesRead.add(rm[1]);

    const pm = t.match(/(\d+)\s+(?:tests?\s+)?passed/i);
    if (pm?.[1]) testsPassed = Math.max(testsPassed, parseInt(pm[1], 10));

    const fm = t.match(/(\d+)\s+(?:tests?\s+)?failed/i);
    if (fm?.[1]) testsFailed = Math.max(testsFailed, parseInt(fm[1], 10));

    if (/\[Tool: Bash\]\s*\$\s*git\s+commit/.test(t)) commits++;

    const rr = t.match(/\[Result:\s*\w+\s*\((\d+(?:\.\d+)?)s\)\s*\$?([\d.]+)?\]/);
    if (rr) {
      durationSeconds = parseFloat(rr[1]);
      if (rr[2]) costUsd = parseFloat(rr[2]);
    }

    if (/\[System Error:/.test(t)) {
      const m = t.match(/\[System Error:\s*(.+)\]/);
      if (m?.[1]) errors.push(m[1]);
    }
  }

  if (filesEdited.size + filesCreated.size + testsPassed + testsFailed + commits === 0) return null;

  return {
    filesEdited: [...filesEdited],
    filesCreated: [...filesCreated],
    filesRead: [...filesRead],
    testsRun: testsPassed + testsFailed,
    testsPassed,
    testsFailed,
    commits,
    errors,
    durationSeconds,
    costUsd,
  };
}
