/**
 * RetroParse
 *
 * Pure parsing/selection layer for the process retrospective's AI output:
 * extracts the findings JSON, validates each finding against the fixed
 * category/severity vocabulary (drop-invalid, fail-open), normalizes slugs,
 * selects the filed subset, and builds stable dedup keys. No I/O.
 */
import type { ParsedFinding, RetroCategory, RetroFinding, RetroSeverity } from './retro-types';

/** Fixed category vocabulary the retro AI may use (anything else is dropped). */
export const RETRO_CATEGORIES: readonly RetroCategory[] = [
  'critic_loop',
  'repair_loop',
  'replan_loop',
  'anomaly_cause',
  'phase_wallclock',
  'gate_jurisdiction',
  'process_other',
] as const;

/**
 * Severity → ordering weight, same ordering as the concern backlog's
 * SEVERITY_WEIGHT (concern-backlog-service.ts).
 */
export const SEVERITY_ORDER: Record<RetroSeverity, number> = {
  urgent: 0.95,
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

/** Only these severities get filed (backlog-cap pressure control). */
const FILED_SEVERITIES: ReadonlySet<RetroSeverity> = new Set(['urgent', 'high']);

/** Per-task cap on filed retro concerns. */
export const MAX_RETRO_CONCERNS = 2;

const RECOMMENDATION_MAX_CHARS = 500;
const EVIDENCE_MAX_CHARS = 1000;

/**
 * Normalize free text into a stable dedup slug: lowercase, non-alnum runs to
 * single hyphens, trimmed, capped at 40 chars. Anything that does not survive
 * as /^[a-z0-9][a-z0-9-]{2,39}$/ yields null (the finding is then dropped).
 *
 * @param raw - AI-provided slug. / AI出力のslug
 * @returns Normalized slug, or null when invalid. / 正規化slug(不正はnull)
 */
export function normalizeSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    // Re-trim: the 40-char cut can leave a trailing hyphen.
    .replace(/-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(slug) ? slug : null;
}

/** Outcome of parsing the AI response: findings plus a structural-failure flag. */
export interface ParseFindingsResult {
  findings: ParsedFinding[];
  /** True when no findings payload could be extracted at all (broken output). */
  parseFailed: boolean;
}

function validateFinding(raw: unknown): RetroFinding | null {
  if (raw === null || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;

  const category = f.category;
  if (typeof category !== 'string' || !RETRO_CATEGORIES.includes(category as RetroCategory)) {
    return null;
  }
  const severity = f.severity;
  if (typeof severity !== 'string' || !(severity in SEVERITY_ORDER)) return null;
  if (typeof f.systemic !== 'boolean') return null;

  const slug = normalizeSlug(f.slug);
  if (slug === null) return null;

  const recommendation =
    typeof f.recommendation === 'string'
      ? f.recommendation.trim().slice(0, RECOMMENDATION_MAX_CHARS)
      : '';
  if (!recommendation) return null;

  const evidence = typeof f.evidence === 'string' ? f.evidence.slice(0, EVIDENCE_MAX_CHARS) : '';

  return {
    category: category as RetroCategory,
    severity: severity as RetroSeverity,
    systemic: f.systemic,
    slug,
    recommendation,
    evidence,
  };
}

/**
 * Parse the AI response into validated findings with an explicit structural
 * failure flag: unparseable JSON / non-array findings → parseFailed=true and
 * zero findings (fail-open); individually invalid findings are dropped without
 * failing the batch.
 *
 * @param raw - AI response text. / AI応答テキスト
 * @returns Findings plus the parse-failure flag. / 検証済みfindingsと失敗フラグ
 */
export function parseFindingsResult(raw: string): ParseFindingsResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { findings: [], parseFailed: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { findings: [], parseFailed: true };
  }
  if (parsed === null || typeof parsed !== 'object') return { findings: [], parseFailed: true };

  const findings = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return { findings: [], parseFailed: true };

  const out: ParsedFinding[] = [];
  for (const f of findings) {
    const valid = validateFinding(f);
    if (valid) out.push(valid);
  }
  return { findings: out, parseFailed: false };
}

/**
 * Parse the AI response into validated findings; structural failures yield an
 * empty list (fail-open). Thin wrapper over {@link parseFindingsResult}.
 *
 * @param raw - AI response text. / AI応答テキスト
 * @returns Validated findings (possibly empty). / 検証済みfindings
 */
export function parseFindings(raw: string): ParsedFinding[] {
  return parseFindingsResult(raw).findings;
}

/**
 * Select the findings worth filing: systemic AND severity in {urgent, high},
 * ordered by severity weight descending (ties keep input order), capped at
 * MAX_RETRO_CONCERNS.
 *
 * @param findings - Validated findings. / 検証済みfindings
 * @returns At most 2 findings to file. / 起票対象(最大2件)
 */
export function selectConcerns(findings: RetroFinding[]): RetroFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.systemic && FILED_SEVERITIES.has(finding.severity))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[b.finding.severity] - SEVERITY_ORDER[a.finding.severity] ||
        a.index - b.index,
    )
    .slice(0, MAX_RETRO_CONCERNS)
    .map(({ finding }) => finding);
}

/**
 * Build the stable concern dedup key. Deliberately contains NO task id —
 * systemic defects recur across tasks, so all tasks observing the same
 * category+slug collapse into one concern (submitConcern's dedup).
 *
 * @param category - Finding category. / カテゴリ
 * @param slug - Normalized slug. / 正規化slug
 * @returns The dedup key. / dedupキー
 */
export function buildDedupKey(category: RetroCategory, slug: string): string {
  return `retro:${category}:${slug}`;
}
