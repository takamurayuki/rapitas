/**
 * pii-risk/risk-assessor
 *
 * Scores error-log text for leak risk from two axes: PII hit count and
 * estimated token volume. Maps the score to a four-step RiskLevel that
 * drives the staged mitigation in mitigate.ts. Not responsible for
 * detection patterns or masking.
 */

import { estimateTokens } from '../../workflow/workflow-context-metrics';
import { detectPii, type PiiHit } from './pii-detector';

/** Staged risk level driving mitigation strength. */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Result of one risk assessment pass. */
export interface RiskAssessment {
  /** 0-100 combined score. */
  score: number;
  level: RiskLevel;
  piiHits: PiiHit[];
  /** Total match count across all PII types. */
  piiHitCount: number;
  /** Estimated token volume of the assessed text. */
  tokenCount: number;
}

/** Points per PII match. One hit = 20; three hits saturate the PII axis. */
export const PII_HIT_WEIGHT = 20;
/** Cap of the PII axis contribution. */
export const PII_SCORE_MAX = 60;
/** Token bucket size — every 50 estimated tokens adds TOKEN_BUCKET_WEIGHT points. */
export const TOKEN_BUCKET_SIZE = 50;
/** Points per token bucket. */
export const TOKEN_BUCKET_WEIGHT = 5;
/** Cap of the token axis contribution (reached at 400 tokens). */
export const TOKEN_SCORE_MAX = 40;

/** Score thresholds: score < medium → low, < high → medium, < critical → high. */
export const RISK_THRESHOLDS = { medium: 40, high: 70, critical: 90 } as const;

/**
 * Maps a 0-100 score to its RiskLevel band.
 *
 * @param score - Combined risk score / 合成リスクスコア
 * @returns The level band the score falls into / スコアが属するレベル帯
 */
export function resolveRiskLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.critical) return 'critical';
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Assesses leak risk of a text from PII hits and token volume.
 *
 * @param text - Secret-masked text to assess / 評価対象テキスト（シークレットマスク済み前提）
 * @returns Score, level and the inputs that produced them / スコア・レベルと算出根拠
 */
export function assessRisk(text: string): RiskAssessment {
  const piiHits = detectPii(text);
  const piiHitCount = piiHits.reduce((sum, h) => sum + h.count, 0);
  const tokenCount = estimateTokens(text);
  const piiScore = Math.min(PII_SCORE_MAX, piiHitCount * PII_HIT_WEIGHT);
  const tokenScore = Math.min(
    TOKEN_SCORE_MAX,
    Math.floor(tokenCount / TOKEN_BUCKET_SIZE) * TOKEN_BUCKET_WEIGHT,
  );
  const score = Math.min(100, piiScore + tokenScore);
  return { score, level: resolveRiskLevel(score), piiHits, piiHitCount, tokenCount };
}
