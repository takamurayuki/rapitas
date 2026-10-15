/**
 * PromptComparisonAlphaStorage
 *
 * File-backed persistence for the alpha-spending ledger — a single shared
 * JSON file (~/.rapitas/.prompt-comparisons/_alpha-ledger.json) tracking each
 * candidate's arrival order (k) and per-candidate look count (j), guarded by
 * the same `wx`-flag exclusive-create lock pattern as
 * prompt-comparison-store.ts. All candidates share one file (unlike the
 * per-candidate comparison records), so this lock is contended across
 * candidates and retries briefly before giving up.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dataDir } from './prompt-comparison-store';
import { decideWithAlphaSpending, type AlphaDecision } from './prompt-comparison-alpha-ledger';

/** Per-candidate alpha-spending state, keyed by String(promptEvolutionId). */
export interface AlphaLedgerState {
  nextK: number;
  candidates: Record<
    string,
    {
      k: number;
      nextJ: number;
      history: AlphaDecision[];
    }
  >;
}

const LOCK_RETRY_COUNT = 5;
const LOCK_RETRY_DELAY_MS = 20;

function ledgerFile(): string {
  return join(dataDir(), '_alpha-ledger.json');
}

function ledgerLockFile(): string {
  return `${ledgerFile()}.lock`;
}

function emptyState(): AlphaLedgerState {
  return { nextK: 1, candidates: {} };
}

function isAlphaLedgerState(value: unknown): value is AlphaLedgerState {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<AlphaLedgerState>;
  return typeof v.nextK === 'number' && typeof v.candidates === 'object' && v.candidates !== null;
}

/**
 * Read the alpha-spending ledger. A missing, corrupt, or schema-mismatched
 * file degrades to the empty state rather than throwing.
 *
 * @returns The ledger state, or the empty state when absent/invalid. / 台帳状態
 */
export function readAlphaLedger(): AlphaLedgerState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(ledgerFile(), 'utf8'));
    return isAlphaLedgerState(parsed) ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

/**
 * Persist the alpha-spending ledger (create or overwrite).
 *
 * @param state - Ledger state to persist. / 保存する台帳状態
 * @returns True when the write succeeded. / 書込成功なら true
 */
export function writeAlphaLedger(state: AlphaLedgerState): boolean {
  try {
    const file = ledgerFile();
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the shared alpha-ledger lock (single file, contended across all
 * candidates).
 *
 * @returns True when the lock was acquired. / ロック取得に成功したら true
 */
export function acquireAlphaLedgerLock(): boolean {
  const file = ledgerLockFile();
  try {
    if (existsSync(file)) return false;
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(file, String(Date.now()), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the shared alpha-ledger lock. Safe to call even when the lock was
 * never acquired (no-op on a missing file).
 */
export function releaseAlphaLedgerLock(): void {
  try {
    unlinkSync(ledgerLockFile());
  } catch {
    // Absent file = already released; never throw into a caller.
  }
}

/**
 * Record an alpha-spending decision for one candidate's evaluation, assigning
 * its arrival order (k) on first sight and incrementing its look count (j) on
 * every call. Retries the shared lock briefly before giving up, since the
 * ledger file is contended across all candidates.
 *
 * @param promptEvolutionId - Candidate id. / 候補ID
 * @param pValue - One-sided Fisher exact p-value for this evaluation. / この評価のp値
 * @returns The alpha-spending decision for this (k, j) pair. / このk,j組のα-spending判定
 * @throws {Error} When the lock cannot be acquired after retrying. / リトライ後もロック取得できない場合
 */
export function recordAlphaSpendingDecision(
  promptEvolutionId: number,
  pValue: number,
): AlphaDecision {
  let acquired = false;
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    if (acquireAlphaLedgerLock()) {
      acquired = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_DELAY_MS);
  }
  if (!acquired) {
    throw new Error('alpha ledger lock timeout');
  }

  try {
    const state = readAlphaLedger();
    const key = String(promptEvolutionId);
    const existing = state.candidates[key];
    const k = existing ? existing.k : state.nextK++;
    const j = existing ? existing.nextJ : 1;
    const decision = decideWithAlphaSpending(k, j, pValue);

    if (existing) {
      existing.nextJ = j + 1;
      existing.history.push(decision);
    } else {
      state.candidates[key] = { k, nextJ: j + 1, history: [decision] };
    }
    writeAlphaLedger(state);
    return decision;
  } finally {
    releaseAlphaLedgerLock();
  }
}
