/**
 * Canary Ledger
 *
 * Persists issued canary tokens and the deployment stage in a JSON file under
 * the data directory, and enforces the isolated -> production promotion gate.
 * It does not detect hits (canary-service.ts) and never touches the DB schema
 * or the OS keychain, which is reserved for real secrets.
 */
import { randomBytes } from 'crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { countCanaryHits, getCanaryDataDir } from './canary-event-log';
import type {
  CanaryFalsePositiveReview,
  CanaryLedger,
  CanaryStage,
  CanaryToken,
} from './canary-types';

/** Base URL used when none is supplied (desktop build: local verification only). */
export const DEFAULT_CANARY_BASE_URL = 'http://127.0.0.1:3001';

/** Raised for any rejected ledger operation; the route layer maps it to HTTP 400. */
export class CanaryLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryLedgerError';
  }
}

// services/security -> repository root. Placing a canary inside rapitas itself
// would make our own agents trip it.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function ledgerPath(): string {
  return join(getCanaryDataDir(), 'canary', 'ledger.json');
}

function emptyLedger(): CanaryLedger {
  return { stage: 'isolated', promotion: null, tokens: [] };
}

/**
 * Load the ledger, returning an empty isolated ledger when none exists yet.
 *
 * @returns Current ledger / 現在の台帳
 */
export function loadLedger(): CanaryLedger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Partial<CanaryLedger>;
    return {
      stage: parsed.stage === 'production' ? 'production' : 'isolated',
      promotion: parsed.promotion ?? null,
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    };
  } catch {
    return emptyLedger();
  }
}

/**
 * Persist the ledger atomically (write temp file, then rename).
 *
 * @param ledger - Ledger to store / 保存する台帳
 */
export function saveLedger(ledger: CanaryLedger): void {
  const file = ledgerPath();
  mkdirSync(dirname(file), { recursive: true });
  // pid alone is not unique: two saves in one process would share a temp file.
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  renameSync(tmp, file);
}

/**
 * Look up a token by id.
 *
 * @param tokenId - Token id from the URL / URL中のトークンID
 * @returns The token or undefined / 見つからなければ undefined
 */
export function findToken(tokenId: string): CanaryToken | undefined {
  return loadLedger().tokens.find((t) => t.tokenId === tokenId);
}

function isForbiddenPlacement(path: string): boolean {
  const abs = resolve(path);
  if (abs.split(sep).includes('.worktrees')) return true;
  return abs === REPO_ROOT || abs.startsWith(REPO_ROOT + sep);
}

/** Input of {@link issueToken}. */
export interface IssueTokenInput {
  label: string;
  placement: CanaryStage;
  placementPath?: string | null;
  baseUrl?: string;
}

/**
 * Issue a new canary token and append it to the ledger.
 *
 * @param input - Label, placement class, optional path and base URL / 発行条件
 * @returns The issued token / 発行されたトークン
 * @throws {CanaryLedgerError} production placement while isolated, or a placement path inside rapitas itself / 段階または配置先が不正
 */
export function issueToken(input: IssueTokenInput): CanaryToken {
  const ledger = loadLedger();
  if (input.placement === 'production' && ledger.stage !== 'production') {
    throw new CanaryLedgerError(
      'production placement is not allowed before promotion (stage=isolated)',
    );
  }
  if (input.placementPath && isForbiddenPlacement(input.placementPath)) {
    throw new CanaryLedgerError(
      'placementPath must not be inside .worktrees or the rapitas repository',
    );
  }
  const tokenId = randomBytes(16).toString('hex');
  const base = (input.baseUrl || DEFAULT_CANARY_BASE_URL).replace(/\/+$/, '');
  const token: CanaryToken = {
    tokenId,
    label: input.label,
    placement: input.placement,
    placementPath: input.placementPath ?? null,
    url: `${base}/canary/hit/${tokenId}`,
    createdAt: new Date().toISOString(),
    lastNotifiedAt: null,
  };
  ledger.tokens.push(token);
  saveLedger(ledger);
  return token;
}

/** Result of {@link claimNotificationWindow}. */
export interface NotificationClaim {
  claimed: boolean;
  /** Previous anchor, needed to release a claim whose notification failed. */
  previous: string | null;
}

/**
 * Atomically claim the aggregation window for a token. The read-check-write is
 * fully synchronous, so concurrent hits in one process cannot both claim it;
 * the claim must therefore be taken BEFORE awaiting the notification.
 *
 * @param tokenId - Token id / トークンID
 * @param nowIso - ISO time of this hit / ヒット時刻
 * @param windowMs - Aggregation window length / 集約窓の長さ
 * @returns Whether this caller owns the notification / 通知権を得たか
 */
export function claimNotificationWindow(
  tokenId: string,
  nowIso: string,
  windowMs: number,
): NotificationClaim {
  const ledger = loadLedger();
  const token = ledger.tokens.find((t) => t.tokenId === tokenId);
  if (!token) return { claimed: false, previous: null };
  const last = token.lastNotifiedAt ? Date.parse(token.lastNotifiedAt) : NaN;
  if (!Number.isNaN(last) && Date.parse(nowIso) - last < windowMs) {
    return { claimed: false, previous: token.lastNotifiedAt };
  }
  const previous = token.lastNotifiedAt;
  token.lastNotifiedAt = nowIso;
  saveLedger(ledger);
  return { claimed: true, previous };
}

/**
 * Undo a claim whose notification could not be delivered, so the next hit alerts.
 *
 * @param tokenId - Token id / トークンID
 * @param claimedIso - Anchor written by the claim / 取得時に書いた時刻
 * @param previous - Anchor to restore / 復元する時刻
 */
export function releaseNotificationClaim(
  tokenId: string,
  claimedIso: string,
  previous: string | null,
): void {
  const ledger = loadLedger();
  const token = ledger.tokens.find((t) => t.tokenId === tokenId);
  // Only roll back our own claim; a later successful claim must stay.
  if (!token || token.lastNotifiedAt !== claimedIso) return;
  token.lastNotifiedAt = previous;
  saveLedger(ledger);
}

function validateReview(review: CanaryFalsePositiveReview | undefined): void {
  if (!review || typeof review !== 'object') {
    throw new CanaryLedgerError('falsePositiveReview is required to promote to production');
  }
  if (review.acknowledgedFalsePositiveReview !== true) {
    throw new CanaryLedgerError('acknowledgedFalsePositiveReview must be true');
  }
  if (typeof review.reviewer !== 'string' || review.reviewer.trim().length === 0) {
    throw new CanaryLedgerError('falsePositiveReview.reviewer is required');
  }
  if (typeof review.reviewedAt !== 'string' || Number.isNaN(Date.parse(review.reviewedAt))) {
    throw new CanaryLedgerError('falsePositiveReview.reviewedAt must be an ISO date');
  }
  const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
  if (!isCount(review.isolatedHitCount) || !isCount(review.falsePositiveCount)) {
    throw new CanaryLedgerError('hit and false-positive counts must be non-negative integers');
  }
  if (review.falsePositiveCount > review.isolatedHitCount) {
    throw new CanaryLedgerError('falsePositiveCount cannot exceed isolatedHitCount');
  }
}

/**
 * Promote the deployment to production after a human false-positive review.
 * There is deliberately no automatic promotion path.
 *
 * @param review - Evidence of the review of isolated detections / 誤検知確認の記録
 * @returns Updated ledger / 更新後の台帳
 * @throws {CanaryLedgerError} when the review evidence is missing or malformed / 確認記録が不備
 */
export function promoteToProduction(review: CanaryFalsePositiveReview): CanaryLedger {
  validateReview(review);
  // The count is compared with the detection log itself: a self-reported
  // number alone would let the gate be passed without any isolated evidence.
  const actual = countCanaryHits('isolated');
  if (review.isolatedHitCount !== actual) {
    throw new CanaryLedgerError(
      `isolatedHitCount (${review.isolatedHitCount}) does not match the detection log (${actual})`,
    );
  }
  const ledger = loadLedger();
  ledger.stage = 'production';
  ledger.promotion = { ...review };
  saveLedger(ledger);
  return ledger;
}
