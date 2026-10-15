/**
 * pii-risk
 *
 * Barrel for the PII leak-risk pipeline: detection (pii-detector),
 * scoring (risk-assessor), and staged mitigation (mitigate).
 */

export { PII_PATTERNS, detectPii, type PiiType, type PiiHit } from './pii-detector';
export {
  assessRisk,
  resolveRiskLevel,
  RISK_THRESHOLDS,
  PII_HIT_WEIGHT,
  PII_SCORE_MAX,
  TOKEN_BUCKET_SIZE,
  TOKEN_BUCKET_WEIGHT,
  TOKEN_SCORE_MAX,
  type RiskLevel,
  type RiskAssessment,
} from './risk-assessor';
export {
  mitigateText,
  mitigateContext,
  PII_TRUNCATE_MAX_CHARS,
  TRUNCATED_SUFFIX,
} from './mitigate';
