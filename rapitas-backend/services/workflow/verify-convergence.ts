/**
 * verify-convergence
 *
 * Pure functions deciding whether a verify→implement repair loop has stopped
 * converging: the SAME acceptance criterion flagged as unaddressed by N+ repair
 * bounces (default 3, not necessarily consecutive — task 614's real pattern was
 * A→B→A) WITHOUT the indicted set shrinking means the task is treading water and must be cut off + escalated instead of
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
  /** True when the repair loop must be cut off (same criterion flagged threshold+ times without the indicted set shrinking). */
  cutoff: boolean;
  /** 1-based index of the repeatedly-flagged criterion (when cutoff). */
  criterionIndex?: number;
  /** How many repair reasons flagged that criterion (when cutoff). */
  count?: number;
  /** Indicted criteria of the latest prior reason (when cutoff). */
  previousCriteria?: number[];
  /** Indicted criteria of the current reason, undeterminable items excluded (when cutoff). */
  currentCriteria?: number[];
  /**
   * The verifier finding (quoted «…» evidence) handed back unchanged `count`
   * times, when the cutoff came from verify-repeat-evidence.ts instead of a
   * criterion. Mutually exclusive with `criterionIndex`.
   */
  repeatedEvidence?: string;
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

/** Default number of repair reasons indicting one criterion before the trend check applies. */
export const DEFAULT_NONCONVERGENCE_THRESHOLD = 3;

/**
 * Phrases by which a judge self-reports that a finding cannot be decided from
 * the diff (real-environment premises etc.). Judge output is free text, so
 * matching is per line and deliberately keyword-based; extend here.
 */
const UNDETERMINABLE_MARKERS = ['差分では判定不能', '判定できない', '判定不能', '要確認', '未検証'];

/**
 * Resolve the non-convergence threshold from an env-like map
 * (`RAPITAS_VERIFY_NONCONVERGENCE_THRESHOLD`). Anything but a positive integer
 * falls back to the default so a typo can never disable the detector.
 *
 * @param env - Environment map. / 環境変数マップ
 * @returns Threshold (>= 1). / 閾値
 */
export function resolveNonConvergenceThreshold(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.RAPITAS_VERIFY_NONCONVERGENCE_THRESHOLD?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_NONCONVERGENCE_THRESHOLD;
  const n = parseInt(raw, 10);
  return n >= 1 ? n : DEFAULT_NONCONVERGENCE_THRESHOLD;
}

/**
 * Criteria indicted by a reason, minus those flagged ONLY on lines where the
 * judge admits it cannot decide from the diff. A criterion that is also
 * indicted on a decisive line is kept.
 *
 * @param reason - Repair-bounce reason. / 差し戻し理由
 * @param criteria - Acceptance criterion bodies. / 受入基準本文
 * @returns Sorted 1-based indices. / 判定可能な指摘基準番号
 */
export function stripUndeterminableIndictments(reason: string, criteria: string[]): number[] {
  const all = identifyIndictedCriteria(reason, criteria);
  if (all.length === 0) return all;
  const marked = new Set<number>();
  const decisive = new Set<number>();
  // The diff-review verdict arrives as ONE line — automated-verifier joins the
  // judge's reasons with " / " — so a newline split saw a single segment, and
  // one "要確認:" side remark anywhere in it marked EVERY indicted criterion
  // undeterminable. Measured 2026-09-20: task 1007's four judge bounces all
  // indicted criterion 3 decisively, all carried a "要確認" aside, and the
  // cutoff never fired (nor for 1009's five, 1014's three). Split on the join
  // separator as well so each finding is judged on its own.
  for (const line of reason.split(/\r?\n| \/ /)) {
    const target = UNDETERMINABLE_MARKERS.some((m) => line.includes(m)) ? marked : decisive;
    for (const n of identifyIndictedCriteria(line, criteria)) target.add(n);
  }
  return all.filter((n) => !marked.has(n) || decisive.has(n));
}

/**
 * Decide whether the repair loop stopped converging. Stage 1: some criterion
 * must be indicted by `threshold`+ reasons (current included, not necessarily
 * consecutive). Stage 2: the current indicted set (self-reported undeterminable
 * items excluded) must not have SHRUNK versus the latest prior non-empty set —
 * a shrinking set is progress (task 996), an equal/larger one is treading water
 * (task 995). Every unidentifiable input fails open (`cutoff:false`): stopping
 * a progressing task by mistake is worse than one extra bounce.
 *
 * @param currentReason - The reason about to trigger a bounce (not yet recorded). / 今回の理由
 * @param priorReasons - Reasons of prior verify_repair transitions, oldest first. / 過去の理由（古い順）
 * @param criteria - Acceptance criterion bodies. / 受入基準本文
 * @param threshold - Indictments of one criterion required before the trend check. / 閾値
 * @returns Cutoff verdict with the repeated criterion, count and both sets. / 判定
 */
export function detectNonConvergence(
  currentReason: string,
  priorReasons: string[],
  criteria: string[],
  threshold: number = DEFAULT_NONCONVERGENCE_THRESHOLD,
): ConvergenceVerdict {
  if (criteria.length === 0) return { cutoff: false };

  const priorSets = priorReasons.map((r) => stripUndeterminableIndictments(r, criteria));
  const currentSet = stripUndeterminableIndictments(currentReason, criteria);
  if (currentSet.length === 0) return { cutoff: false };

  const counts = new Map<number, number>();
  // Set-per-reason: a reason mentioning the same criterion twice is ONE bounce.
  for (const set of [...priorSets, currentSet]) {
    for (const idx of set) counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  let hit: { criterionIndex: number; count: number } | null = null;
  for (const [idx, count] of counts) {
    if (count >= threshold && (!hit || idx < hit.criterionIndex))
      hit = { criterionIndex: idx, count };
  }
  if (!hit) return { cutoff: false };

  const previousSet = [...priorSets].reverse().find((s) => s.length > 0);
  if (!previousSet || currentSet.length < previousSet.length) return { cutoff: false };
  return { cutoff: true, ...hit, previousCriteria: previousSet, currentCriteria: currentSet };
}
