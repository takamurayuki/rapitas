/**
 * Canary Event Log
 *
 * Appends canary detections to a dedicated daily NDJSON file, kept apart from
 * the cycle log and from anything that records access to real secrets.
 * It never throws: a failed write must not drop the alert path that follows.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CanaryHitRecord, CanaryStage } from './canary-types';

/**
 * Resolve the data directory shared with the other file-based logs.
 *
 * @returns Absolute data directory / データディレクトリ
 */
export function getCanaryDataDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  return override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
}

/**
 * Path of the detection log for a given day.
 *
 * @param stamp - YYYY-MM-DD / 日付
 * @returns Absolute file path / ファイルパス
 */
export function getCanaryLogFilePath(stamp: string): string {
  return join(getCanaryDataDir(), 'logs', `canary-${stamp}.ndjson`);
}

/**
 * Count recorded detections for a stage across all daily canary logs.
 * Used to check a promotion review against the actual evidence rather than a
 * self-reported number. Unreadable files and malformed lines are skipped.
 *
 * @param stage - Stage whose detections to count / 集計対象の段階
 * @returns Number of matching log lines / 該当する検知件数
 */
export function countCanaryHits(stage: CanaryStage): number {
  const dir = join(getCanaryDataDir(), 'logs');
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /^canary-.*\.ndjson$/.test(n));
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    let text: string;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        if ((JSON.parse(line) as { stage?: string }).stage === stage) count++;
      } catch {
        // Corrupt line: not valid evidence, so it is not counted.
      }
    }
  }
  return count;
}

/**
 * Append one detection record as a single NDJSON line.
 *
 * @param record - Detection to persist / 記録する検知
 * @returns true when written, false when the write failed / 書込成否
 */
export function appendCanaryHit(record: CanaryHitRecord): boolean {
  // Unlike the cycle logger there is deliberately no NODE_ENV==='test' skip:
  // a silently skipped write would make the audit trail untestable.
  try {
    const file = getCanaryLogFilePath(record.t.slice(0, 10));
    mkdirSync(join(getCanaryDataDir(), 'logs'), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
