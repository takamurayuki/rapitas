/**
 * plan-deviation/operation-store
 *
 * Append-only NDJSON store of the operations an execution performed
 * (`<logs dir>/plan-ops/<executionId>.ndjson`). Judging features are taken
 * from the raw tool input at write time; every human-readable string is
 * masked BEFORE it touches disk. File-based on purpose — a Prisma table would
 * need a schema push + server restart (see plan.md 申し送り #1).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { getCycleLogFilePath } from '../../observability/cycle-event-logger';
import { maskDeviationText } from './deviation-mask';
import { extractOperations } from './operation-extractor';
import type { OperationRecord } from './types';

/** Default per-execution line cap; later operations are dropped and reported. */
export const DEFAULT_MAX_OPERATION_LINES = 5000;

/** Options for creating a store (tests inject a temp dir). */
export interface OperationStoreOptions {
  /** Directory that holds `plan-ops/`; defaults to the cycle-log directory. */
  baseDir?: string;
  maxLines?: number;
}

/** Result of reading one execution's operations. */
export interface ReadOperationsResult {
  operations: OperationRecord[];
  warnings: string[];
}

/** Store API. */
export interface OperationStore {
  recordToolUse(
    executionId: number,
    toolName: string,
    input: unknown,
    logSequence?: number,
  ): number;
  readOperations(executionId: number): ReadOperationsResult;
  hasOperations(executionId: number): boolean;
}

/**
 * Resolve the shared data directory used for deviation files.
 *
 * @returns The directory holding the daily cycle logs / サイクルログと同じディレクトリ
 */
export function getDeviationDataDir(): string {
  return dirname(getCycleLogFilePath());
}

/** Marker line written once when the cap is reached. */
interface TruncationMarker {
  truncated: true;
  maxLines: number;
}

/**
 * Create an operation store.
 *
 * @param options - Base directory and line cap / 保存先と行数上限
 * @returns Store bound to the directory / ストア
 */
export function createOperationStore(options: OperationStoreOptions = {}): OperationStore {
  const maxLines = options.maxLines ?? DEFAULT_MAX_OPERATION_LINES;
  const dir = join(options.baseDir ?? getDeviationDataDir(), 'plan-ops');
  // Per-execution line counters; seeded from disk on first touch so seq
  // stays monotonic across restarts.
  const counters = new Map<number, { count: number; truncated: boolean }>();

  const fileFor = (executionId: number) => join(dir, `${Math.trunc(executionId)}.ndjson`);

  const counterFor = (executionId: number) => {
    let c = counters.get(executionId);
    if (!c) {
      const { operations, warnings } = readOperations(executionId);
      c = { count: operations.length, truncated: warnings.some((w) => w.startsWith('truncated')) };
      counters.set(executionId, c);
    }
    return c;
  };

  function readOperations(executionId: number): ReadOperationsResult {
    const file = fileFor(executionId);
    if (!existsSync(file)) return { operations: [], warnings: [] };
    const operations: OperationRecord[] = [];
    const warnings: string[] = [];
    let corrupt = 0;
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as OperationRecord | TruncationMarker;
        if ('truncated' in parsed) {
          warnings.push(
            `truncated: operation log reached ${parsed.maxLines} lines; later operations were not recorded`,
          );
        } else {
          operations.push(parsed);
        }
      } catch {
        corrupt++;
      }
    }
    if (corrupt > 0) warnings.push(`${corrupt} corrupt operation line(s) skipped`);
    return { operations, warnings };
  }

  return {
    recordToolUse(executionId, toolName, input, logSequence) {
      const extracted = extractOperations(toolName, input);
      if (extracted.length === 0) return 0;
      const counter = counterFor(executionId);
      mkdirSync(dir, { recursive: true });
      const file = fileFor(executionId);
      let written = 0;
      for (const op of extracted) {
        if (counter.count >= maxLines) {
          if (!counter.truncated) {
            const marker: TruncationMarker = { truncated: true, maxLines };
            appendFileSync(file, `${JSON.stringify(marker)}\n`, 'utf-8');
            counter.truncated = true;
          }
          break;
        }
        counter.count += 1;
        const record: OperationRecord = {
          seq: counter.count,
          occurredAt: new Date().toISOString(),
          kind: op.kind,
          tool: op.tool,
          features: {
            ...op.features,
            ...(op.features.path ? { path: maskDeviationText(op.features.path) } : {}),
          },
          displayMasked: maskDeviationText(`${op.tool}: ${op.summary}`),
          ...(typeof logSequence === 'number' ? { logSequence } : {}),
        };
        // One JSON object per appendFileSync call keeps each line intact even
        // if two executions write concurrently (they use separate files anyway).
        appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
        written++;
      }
      return written;
    },
    readOperations,
    hasOperations(executionId) {
      return readOperations(executionId).operations.length > 0;
    },
  };
}

let defaultStore: OperationStore | null = null;

/**
 * Process-wide store writing to the shared data directory.
 *
 * @returns Lazily created default store / 既定ストア
 */
export function getOperationStore(): OperationStore {
  defaultStore ??= createOperationStore();
  return defaultStore;
}
