/**
 * SupervisionWriteSpool
 *
 * Durable, file-backed holding area for supervision writes that failed to reach
 * the DB. A failed intervention write must survive a backend restart and must
 * not be "forgotten" because some unrelated later write succeeded — it stays
 * pending until THAT record is persisted.
 * Not responsible for retrying writes — see intervention-detector.ts.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface SpooledRecord<T> {
  /** Stable identity so exactly this record is removed once persisted. */
  id: string;
  kind: 'intervention';
  spooledAt: string;
  data: T;
}

/**
 * Resolves the spool file path. Same data-dir convention as probe-metrics-store.
 *
 * @returns Absolute JSONL path / スプールファイルの絶対パス
 */
export function spoolFilePath(): string {
  const dataDir = process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
  return join(dataDir, 'supervision', 'pending-writes.jsonl');
}

/**
 * Appends one pending record.
 *
 * @param record - Record that failed to persist / 永続化に失敗した記録
 * @returns true when the spool line was written / 書き込めたら true
 */
export function spoolRecord<T>(record: SpooledRecord<T>): boolean {
  try {
    const path = spoolFilePath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every pending record. Unparseable lines are kept as a non-empty signal:
 * a corrupt spool must not read as "nothing pending".
 *
 * @returns Pending records and the count of unreadable lines / 保留記録と破損行数
 */
export function readSpool<T>(): { records: SpooledRecord<T>[]; corruptLines: number } {
  const path = spoolFilePath();
  if (!existsSync(path)) return { records: [], corruptLines: 0 };
  const records: SpooledRecord<T>[] = [];
  let corruptLines = 0;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SpooledRecord<T>;
      if (parsed && typeof parsed.id === 'string' && parsed.kind === 'intervention') {
        records.push(parsed);
      } else {
        corruptLines += 1;
      }
    } catch {
      corruptLines += 1;
    }
  }
  return { records, corruptLines };
}

/**
 * Removes the records whose ids were persisted, keeping everything else
 * (including corrupt lines) untouched.
 *
 * @param persistedIds - Ids that are now in the DB / DBに記録済みのID
 */
export function removeFromSpool(persistedIds: ReadonlySet<string>): void {
  const path = spoolFilePath();
  if (!existsSync(path) || persistedIds.size === 0) return;
  const kept = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        return !persistedIds.has((JSON.parse(line) as { id?: string }).id ?? '');
      } catch {
        return true;
      }
    });
  writeFileSync(path, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf-8');
}
