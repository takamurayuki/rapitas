/**
 * Bounce Reason Classifier
 *
 * Pure classification of a verify_repair / ci_repair transition into the five
 * manual-triage kinds (plus `other`) used by the weekly loop review.
 * Not responsible for reading transitions or aggregating counts — see
 * bounce-breakdown.ts.
 */

/** Kinds a bounce is sorted into. `other` keeps unclassifiable rows visible. */
export type BounceKind =
  | 'verify_contradiction' // verify report judged self-contradictory
  | 'diff_review' // adversarial diff review rejected the change
  | 'environment' // infrastructure / toolchain problem
  | 'plan_gap' // planned items not done / record missing
  | 'implementation_gap' // verification found the implementation lacking
  | 'other';

/** Every kind, in evaluation order (earlier wins). */
export const BOUNCE_KINDS: readonly BounceKind[] = [
  'verify_contradiction',
  'diff_review',
  'environment',
  'plan_gap',
  'implementation_gap',
  'other',
];

/** Text sources of one bounce. */
export interface BounceText {
  /** metadata.reason of the transition. */
  reason?: string | null;
  /** Unmet sentences: verifyContent, findings, failedChecks flattened to text. */
  detail?: string | null;
}

// NOTE: verify_contradiction is judged per sentence by isAffirmativeContradiction(), not a bare
// "矛盾" match — design/plan contradictions and negations ("矛盾はない") are not
// gate misjudgments and must not feed the misjudgment-candidate filer.
const MACHINE_CONTRADICTION = /self[-_ ]?contradict/i;
// 主語と述語の間は助詞・内容/記述だけを許可し、別の主語をまたがない。
const POSITIVE_CONTRADICTION =
  /(verify\.md|verify[ \t]+report|検証レポート|検証結果)[ \t　]*(?:の(?:内容|記述)[ \t　]*)?(?:が|は|には|に)?[ \t　]*(矛盾している|矛盾しています|矛盾していた|矛盾していました|矛盾と判定|矛盾と判断|矛盾(?:が|を)(?:ある|あります|検出)|自己矛盾)/i;
// Any negative auxiliary/ending anywhere after the first 矛盾 negates the sentence — conjugations
// are never enumerated per phrasing (that approach failed on polite/humble forms 3 times).
// Intentional miss: "矛盾しているため直せない" is also excluded; a missed candidate is cheaper
// than a false filing. Add test rows for gaps instead of editing this expression.
const NEGATION_TAIL =
  /(?:な(?:い|かった|く)|ませ?ん(?:でし(?:た)?)?|ません|ず(?:に)?|なし|無(?:い|かった|し))/;

function isNegatedAfterContradiction(sentence: string): boolean {
  const at = sentence.indexOf('矛盾');
  return at >= 0 && NEGATION_TAIL.test(sentence.slice(at + '矛盾'.length));
}

// English negation before the machine word in the same sentence ("does not self-contradict").
const ENGLISH_NEGATION = /\b(?:not|no|never|without)\b|n't/i;

/**
 * Split text into sentences. A period splits only before whitespace or the end,
 * so "verify.md" stays intact; a missed split can only cause a missed candidate.
 *
 * @param text - Raw text. / 文章
 * @returns Non-empty trimmed sentences. / 空でない文
 */
export function splitSentences(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[。．!?！？\r\n]+|\.(?=\s|$)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Whether one sentence affirmatively judges the verify report contradictory.
 * Each sentence is judged alone: a negation never cancels another sentence.
 *
 * @param sentence - A single sentence. / 1文
 * @returns True only for an affirmative, report-subject judgment. / 肯定的な判定か
 */
export function isAffirmativeContradiction(sentence: string): boolean {
  const machine = MACHINE_CONTRADICTION.exec(sentence);
  if (machine) {
    // NOTE: The machine word used to skip the Japanese check, so
    // 「verify.md は self-contradicts ではない」 was filed as a candidate (diff
    // review, 3rd send-back on criterion 1). Negation on either side excludes it.
    const after = sentence.slice(machine.index + machine[0].length);
    return (
      !ENGLISH_NEGATION.test(sentence.slice(0, machine.index)) &&
      !ENGLISH_NEGATION.test(after) &&
      !NEGATION_TAIL.test(after)
    );
  }
  // A missed candidate is cheaper than a false filing, so negation wins within a sentence.
  if (isNegatedAfterContradiction(sentence)) return false;
  return POSITIVE_CONTRADICTION.test(sentence);
}

/**
 * Sentences (reason and detail judged independently) that affirm a verify
 * contradiction. The filer builds its pattern from these only.
 *
 * @param reason - metadata.reason. / 理由
 * @param detail - Flattened detail text. / 詳細文
 * @returns Adopted sentences. / 採用した文
 */
export function extractContradictionSentences(
  reason: string | null | undefined,
  detail: string | null | undefined,
): string[] {
  return [...splitSentences(reason), ...splitSentences(detail)].filter(isAffirmativeContradiction);
}

const RULES: ReadonlyArray<readonly [Exclude<BounceKind, 'other'>, RegExp]> = [
  ['diff_review', /差分レビュー.{0,6}不合格|diff[-_ ]?review|adversarial|敵対的/i],
  [
    'environment',
    /ERR_PNPM|EADDRINUSE|ポート.{0,12}使用中|port\s+.*in use|address already in use|ENOENT|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EBUSY|ネットワーク/i,
  ],
  [
    'plan_gap',
    /計画項目|plan\s*項目|(設計|計画).{0,10}矛盾|矛盾.{0,10}(設計|計画)|plan\.md.{0,20}(未実施|未完)|チェックリスト.{0,10}(未|不足)|記録(の|が)?不足/i,
  ],
  [
    'implementation_gap',
    /実装(の)?不足|未達|受入(基準|条件).{0,10}(満た|未)|テスト.{0,6}失敗|explicitly marks|自動検証に失敗|not implemented/i,
  ],
];

function firstMatch(text: string): BounceKind {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return 'other';
}

/**
 * Classify the combined reason and detail by kind priority, regardless of
 * which metadata field contains the matching vocabulary.
 *
 * @param input - Reason and detail text (or a plain string reason). / 理由と詳細文
 * @returns The bounce kind; `other` for empty or unmatched text. / 差し戻しの種類
 */
export function classifyBounceReason(input: BounceText | string | null | undefined): BounceKind {
  if (!input) return 'other';
  const { reason, detail } = typeof input === 'string' ? { reason: input, detail: null } : input;
  if (extractContradictionSentences(reason, detail).length > 0) return 'verify_contradiction';
  return firstMatch([reason, detail].filter(Boolean).join('\n'));
}

/** FNV-1a 32-bit hash as 8 hex chars (stable dedupKey component). */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Normalize a bounce sentence so wording that differs only by numbers, ids,
 * paths or hashes maps to one pattern.
 *
 * @param text - Raw reason text. / 理由文
 * @returns Normalized text (max 160 chars). / 正規化した文
 */
export function normalizeBouncePattern(text: string): string {
  return text
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s]*|(?:[\w.-]+[\\/])+[\w.-]*|\/[\w.-]+(?:\/[\w.-]+)*/g, '')
    .replace(/#\d+/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, '')
    .slice(0, 160);
}

/**
 * Stable short id of a bounce sentence's normalized pattern.
 *
 * @param text - Raw reason text. / 理由文
 * @returns 8-char hex id. / パターンID
 */
export function bouncePatternId(text: string): string {
  return shortHash(normalizeBouncePattern(text));
}
