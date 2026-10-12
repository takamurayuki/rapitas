/**
 * Canary Types
 *
 * Shared type definitions for the URL-style canary token feature: ledger,
 * deployment stage and the per-hit detection record.
 * It does not hold any behavior; see canary-ledger.ts / canary-service.ts.
 */

/** Deployment stage. `production` is reachable only through an explicit promotion. */
export type CanaryStage = 'isolated' | 'production';

/** How trustworthy the recorded source IP is. */
export type CanaryTrust =
  /** Raw socket address available and no forwarding header was supplied. */
  | 'direct'
  /** A forwarding header was supplied; it is spoofable and recorded separately. */
  | 'forwarded'
  /** The raw socket address could not be determined. */
  | 'unknown';

/** One issued canary token. */
export interface CanaryToken {
  /** Unguessable random id embedded in the canary URL. */
  tokenId: string;
  /** Human label describing where the token was planted. */
  label: string;
  /** Environment class the token was planted in. */
  placement: CanaryStage;
  /** Directory the token was planted in, if any. */
  placementPath: string | null;
  /** Full canary URL (baseUrl + /canary/hit/<tokenId>). */
  url: string;
  /** ISO time of issuance. */
  createdAt: string;
  /** ISO time of the last notification emitted for this token (aggregation window anchor). */
  lastNotifiedAt: string | null;
}

/** Evidence supplied by a human who reviewed false-positive trends before promotion. */
export interface CanaryFalsePositiveReview {
  /** Explicit acknowledgement that isolated detections were reviewed; must be literally true. */
  acknowledgedFalsePositiveReview: true;
  /** Person who performed the review. */
  reviewer: string;
  /** ISO time of the review. */
  reviewedAt: string;
  /** Number of detections observed while isolated. */
  isolatedHitCount: number;
  /** How many of those detections were judged false positives. */
  falsePositiveCount: number;
}

/** Persisted canary ledger. */
export interface CanaryLedger {
  stage: CanaryStage;
  /** Review that authorized the promotion to production, once promoted. */
  promotion: CanaryFalsePositiveReview | null;
  tokens: CanaryToken[];
}

/** One line of the dedicated detection log. */
export interface CanaryHitRecord {
  /** ISO time of the hit. */
  t: string;
  tokenId: string;
  label: string;
  /** Raw socket address of the caller (null when unavailable). */
  ip: string | null;
  /** Raw X-Forwarded-For header value (spoofable), null when absent. */
  forwardedFor: string | null;
  /** User-Agent header, null when absent. */
  ua: string | null;
  stage: CanaryStage;
  trust: CanaryTrust;
}
