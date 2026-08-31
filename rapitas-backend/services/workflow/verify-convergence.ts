/**
 * verify-convergence
 *
 * Pure functions deciding whether a verify→implement repair loop has stopped
 * converging: the SAME acceptance criterion flagged as unaddressed by 2+ repair
 * bounces (not necessarily consecutive — task 614's real pattern was A→B→A)
 * means the task is treading water and must be cut off + escalated instead of
 * bounced again. Not responsible for DB access, escalation, or transitions —
 * verify-self-repair wires those around these functions.
 */

/**
 * Minimum length for a feature token extracted from a criterion body. Shorter
 * tokens (e.g. `max`, `run`) are too generic and would let an unrelated reason
 * accidentally match a criterion — the false-cutoff failure mode this module
 * must avoid above all (a task progressing through DIFFERENT findings must
 * never be stopped).
 */
const MIN_TOKEN_LEN = 6;

/**
 * File / path tokens: an ASCII run ending in a lowercase extension. Matches a
 * bare `foo.ts` as well as `services/workflow/foo.ts`; deliberately does NOT
 * match prose whose period is followed by a capitalised word.
 */
const FILE_TOKEN_RE = /[A-Za-z0-9_\-][A-Za-z0-9_\-./\\]*\.[a-z0-9]{1,6}/g;

/**
 * Generic workflow-artifact names (WorkflowFile.fileType + `.md`) excluded from
 * feature-token candidacy. phase-output-validator's failure messages always
 * carry a `verify.md ...` prefix regardless of the actual cause (task #800:
 * `verify.md self-contradicts: ...` / `verify.md explicitly marks the
 * verification as failed.`), so a criterion that merely mentions the artifact
 * by name (not an unusual thing for a workflow-focused task to do) makes
 * EVERY repair reason match it — collapsing genuinely distinct rejections
 * into one falsely-repeated criterion and mis-firing the cutoff (task #800:
 * 2026-08-31T04:21:59Z and 05:20:34Z). The other three share the same
 * structural hazard (e.g. `plan_invalid_replan` always mentions `plan.md`).
 */
const WORKFLOW_ARTIFACT_TOKENS = new Set(['research.md', 'question.md', 'plan.md', 'verify.md']);

/** Verdict of the non-convergence check. */
export interface ConvergenceVerdict {
  /** True when the repair loop must be cut off (same criterion flagged 2+ times). */
  cutoff: boolean;
  /** 1-based index of the repeatedly-flagged criterion (when cutoff). */
  criterionIndex?: number;
  /** How many repair reasons flagged that criterion (when cutoff). */
  count?: number;
}

/**
 * Parse the task's acceptanceCriteria column (JSON-array string, nullable)
 * into a string[]. Invalid JSON / non-array / null all yield `[]` so callers
 * fail open (no criteria → no cutoff).
 *
 * NOTE: Local twin of adversarial-diff-review.ts's private parseAcceptanceCriteria —
 * duplicated on purpose: that module is non-exported and drags heavy deps, and
 * this module must stay pure/DB-free (plan 619 forbids touching the diff-review).
 *
 * @param raw - Raw column value (string / array / null). / 生の列値
 * @returns Criterion bodies, or [] when unparseable. / 基準本文の配列
 */
export function parseAcceptanceCriteria(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p: unknown = JSON.parse(raw);
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Explicit criterion-number mentions, ja + en (e.g. 受入基準1 / 基準 #2 / acceptance criterion 3). */
const NUMBER_PATTERNS = [
  /(?:受入|受け入れ)?基準\s*#?\s*(\d+)/g,
  /acceptance\s*criteri(?:on|a|um)?\s*#?\s*(\d+)/gi,
];

/**
 * Extract feature tokens from one criterion body: backtick-quoted identifiers
 * and path-like tokens (e.g. `tests/services/test-triage.test.ts`). Plain
 * prose is deliberately NOT tokenized — common words shared across criteria
 * would make an unrelated reason match and falsely cut off a progressing task.
 * Generic workflow-artifact names (`verify.md` etc., see
 * WORKFLOW_ARTIFACT_TOKENS) are excluded for the same reason: they are not
 * project source files but the workflow's own vocabulary, near-guaranteed to
 * appear in unrelated repair reasons.
 *
 * @param criterion - Criterion body text. / 基準本文
 * @returns Distinct tokens of length >= MIN_TOKEN_LEN. / 特徴トークン
 */
function extractFeatureTokens(criterion: string): string[] {
  const tokens = new Set<string>();
  for (const m of criterion.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (t.length >= MIN_TOKEN_LEN && !WORKFLOW_ARTIFACT_TOKENS.has(t.toLowerCase())) tokens.add(t);
  }
  // File-like: an ASCII path or bare filename ending in a lowercase extension.
  //
  // The previous pattern required TWO separators (one for the character class,
  // one for the trailing extension dot), so a bare `risk-detection.ts` — one
  // dot — matched nothing. Task 666 spent its entire ten-bounce repair budget
  // treading water with five of its six criteria invisible to this function for
  // exactly that reason.
  //
  // The extension is required to be lowercase: real extensions are (.ts, .md,
  // .json), while prose that happens to run a period into a capitalised word
  // is not, and a false token here is the one failure mode this module must
  // avoid — it would stop a task that is genuinely progressing.
  for (const m of criterion.matchAll(FILE_TOKEN_RE)) {
    const t = m[0];
    if (t.length >= MIN_TOKEN_LEN && !WORKFLOW_ARTIFACT_TOKENS.has(t.toLowerCase())) tokens.add(t);
    // Reasons often cite just the basename while the criterion spells the full
    // path.
    const base = t.split(/[/\\\\]/).pop() ?? '';
    if (
      base.length >= MIN_TOKEN_LEN &&
      base.includes('.') &&
      !WORKFLOW_ARTIFACT_TOKENS.has(base.toLowerCase())
    )
      tokens.add(base);
  }
  return [...tokens];
}

/**
 * Map one repair reason to the 1-based indices of the acceptance criteria it
 * indicts. Only DECISIVE signals count: an explicit criterion number, or a
 * feature token (backtick identifier / path) of the criterion appearing in the
 * reason. A reason with neither (e.g. the generic「受入基準を満たしていません」
 * fallback) maps to [] → the caller fails open.
 *
 * @param reason - Repair-bounce reason text. / 差し戻し理由
 * @param criteria - Acceptance criterion bodies. / 受入基準本文
 * @returns 1-based indices (deduplicated). / 指摘された基準番号
 */
export function identifyIndictedCriteria(reason: string, criteria: string[]): number[] {
  if (!reason || criteria.length === 0) return [];
  const found = new Set<number>();

  for (const pattern of NUMBER_PATTERNS) {
    for (const m of reason.matchAll(pattern)) {
      const n = parseInt(m[1], 10);
      if (Number.isInteger(n) && n >= 1 && n <= criteria.length) found.add(n);
    }
  }

  const reasonLower = reason.toLowerCase();
  criteria.forEach((criterion, i) => {
    if (found.has(i + 1)) return;
    if (extractFeatureTokens(criterion).some((t) => reasonLower.includes(t.toLowerCase()))) {
      found.add(i + 1);
    }
  });

  return [...found].sort((a, b) => a - b);
}

/**
 * Decide whether the repair loop stopped converging: counting the CURRENT
 * reason together with all prior reasons in the window, any criterion indicted
 * by 2+ distinct repair reasons (repetition, not necessarily consecutive —
 * A→B→A cuts off) yields a cutoff verdict. Every unidentifiable input fails
 * open (`cutoff:false`): stopping a progressing task by mistake is worse than
 * one extra bounce.
 *
 * @param currentReason - The reason about to trigger a bounce (not yet recorded). / 今回の理由
 * @param priorReasons - Reasons of prior verify_repair transitions in the window. / 過去の理由
 * @param criteria - Acceptance criterion bodies. / 受入基準本文
 * @returns Cutoff verdict with the repeated criterion + count. / 判定
 */
export function detectNonConvergence(
  currentReason: string,
  priorReasons: string[],
  criteria: string[],
): ConvergenceVerdict {
  if (criteria.length === 0) return { cutoff: false };

  const counts = new Map<number, number>();
  for (const reason of [...priorReasons, currentReason]) {
    // Set-per-reason: a reason mentioning the same criterion twice is ONE bounce.
    for (const idx of identifyIndictedCriteria(reason, criteria)) {
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
  }

  let hit: { criterionIndex: number; count: number } | null = null;
  for (const [idx, count] of counts) {
    if (count >= 2 && (!hit || idx < hit.criterionIndex)) hit = { criterionIndex: idx, count };
  }
  return hit ? { cutoff: true, ...hit } : { cutoff: false };
}
