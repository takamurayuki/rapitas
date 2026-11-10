/**
 * repair-cause
 *
 * Classifies one verify→implement repair bounce by WHY it happened, so routing
 * can treat each cause differently (routing2a E): a verified capability gap
 * escalates the next implementer run, an infrastructure failure does not, a
 * requirement defect belongs to replanning, and a finding without grounds is
 * kept apart instead of being counted against the model. Pure; reading the
 * bounce records is repair-escalation.ts's job, and acting on a requirement
 * defect is the bounce caller's (verify-adversarial-review.ts).
 */
import { isCapabilityAttributableFailure } from './routing-policy';
import { stripNonEvidenceRegions } from './verify-scan-text';

/**
 * Why a bounce happened.
 * - capability: a verified failure of the work itself (machine gate NG, a
 *   verify verdict, or an evidenced jury finding the verifier did not refute).
 * - infrastructure: the run could not be judged fairly (limits, timeouts,
 *   a broken environment). A stronger model would hit the same wall.
 * - requirements: the requirement or plan is at fault, not the code.
 * - unfounded: a review rejection whose grounds are missing or refuted.
 */
export type RepairCauseKind = 'capability' | 'infrastructure' | 'requirements' | 'unfounded';

/** The subset of a stored jury finding this classifier reads. */
export interface RepairFindingLike {
  summary?: string;
  gating?: boolean;
  evidence?: string;
  needsCheck?: boolean;
  verification?: string;
}

/** One bounce as recorded: the repair reason and, for a jury bounce, its findings. */
export interface RepairBounceRecord {
  reason: string;
  /** Findings of the adversarial review that caused this bounce; absent when none were stored. */
  findings?: RepairFindingLike[] | null;
  /**
   * The rejected verify.md as stored on the bounce. The validator's summary
   * of an explicit ❌ verdict is a generic sentence, so the actual cause
   * (e.g. "Playwright 未導入") is only readable here.
   */
  verifyContent?: string | null;
}

/**
 * Environment failures. Matched only after {@link stripFaultMentions}, so
 * code that merely HANDLES one of these ("ECONNREFUSED時の例外処理") is not
 * mistaken for a broken environment.
 */
const ENVIRONMENT_FAILURE_RE =
  /(ECONNREFUSED|ECONNRESET|ENOTFOUND|EADDRINUSE|ENOSPC|no space left on device|worktree が存在しません|worktree (?:is )?missing|playwright install|executable doesn'?t exist|command not found|spawn \S+ ENOENT|database (?:is )?(?:unavailable|unreachable)|can'?t reach database|playwright[^\n。|]{0,20}?(?:未導入|未インストール|インストールされていない|not installed)|(?:ブラウザ|chromium|chrome)[^\n。|]{0,20}?(?:未導入|見つからない|起動できない|not found)|(?:DB|データベース|PostgreSQL)[^\n。|]{0,10}?(?:に接続できない|に接続できず|へ接続できない|が起動していない))/i;

/**
 * A failure name used as the SUBJECT of code behaviour: "429応答を処理せず",
 * "ECONNREFUSED時の", "rate limit時の待機", "timed out した時". Removed before
 * the environment / platform patterns run.
 */
const FAULT_MENTION_RE =
  /[A-Za-z0-9_.:'-]+(?:\s*(?:応答|エラー|error|response|status))?\s*(?:未導入|未インストール)?\s*(?:した|する|になった|になる)?\s*(?:時|際|場合|とき|を(?:処理|扱|ハンドル|捕捉|考慮)|への(?:対処|対応)|のハンドリング|の(?:例外)?処理|handling)/gi;

/**
 * The requirement itself is defective: a requirement as the grammatical
 * subject (が/は/自体/同士/の) of contradiction / ambiguity / unverifiability.
 * Deliberately excluded: the implementation failing a requirement
 * ("受入基準2を満たせない実装", "仕様と矛盾する値を返す", "受入基準2と実装が矛盾"),
 * which is a capability failure the implementer can fix.
 */
const REQUIREMENT_DEFECT_RE =
  /((?:受入基準|要件|仕様|acceptance criteri\w*|requirements?)\s*#?\d*(?!\d)\s*(?![とにを])(?:自体|同士)?\s*(?:が|は|の|\s(?:is|are)\b)?(?:(?!実装|コード|implementation|code)[^\n。|]){0,20}?(?:矛盾|曖昧|不明確|検証不能|検証できない|実現不可能|達成不可能|contradict\w*|ambiguous|unverifiable)|存在しない前提|計画(?:の|が)(?:誤り|矛盾|不備)|plan\.md\s*の?[^\n。]{0,20}?(?:誤り|矛盾))/i;

/** A line that reports a failure, not a pass. */
const FAILING_LINE_RE = /❌|✗|✖|=NG\b|\bfail(?:ed|ure|s|ing)?\b|不合格|未達|失敗|実行不可/i;
const PASSING_LINE_RE =
  /✅|(?:失敗|failed?)\s*(?:テスト)?\s*(?:数|件数)?\s*[:：]?\s*0\b|\b0\s+failed\b/i;

/** Verdict vocabulary — a failing line made only of these names no cause. */
const VERDICT_WORDS_RE =
  /[❌✗✖|*#>\-:：\s()（）「」『』[\]—.、。;]|検証|失敗|一部|全体|総合|最終|判定|結果|ステータス|不合格|未達|実行不可|overall|verdict|status|result|fail(?:ed|ure)?|partial|explicitly|reports?|repair|is|required|a|or|the|verify\.md/gi;

/**
 * A failing row that only names WHICH check failed ("- テスト: ❌ 失敗",
 * "| E2E | ❌ 実行不可 |"), not what failed. It summarises the verdict; its
 * cause is whatever the verify.md states beside it, so counting it as a work
 * failure would override a stated environment fault (routing2a-fix2).
 * NOTE: Machine gate rows (`typecheck=NG(3)`) and rows with counts, test
 * names or symptoms do not match and stay specific failures.
 */
const GENERIC_LABEL_LINE_RE =
  /^[\s|*>#-]*(?:(?:単体|結合|統合|ユニット|回帰|E2E|全体の?)?\s*テスト|e2e|unit(?:\s+tests?)?|integration(?:\s+tests?)?|tests?|ビルド|build|lint|型チェック|typecheck)[\s|:：-]*(?:❌|✗|✖)?[\s|:：-]*(?:失敗|不合格|未達|実行不可|fail(?:ed|ure|s)?|NG)?[\s|。.]*$/i;

/** Prefix the adversarial diff review puts on its repair reason (verify-adversarial-review.ts). */
const JURY_BOUNCE_PREFIX = '差分レビュー不合格';

/** Drop failure names that are only the subject of code behaviour. */
function stripFaultMentions(text: string): string {
  return text.replace(FAULT_MENTION_RE, ' ');
}

/** Whether a text describes the run's environment or platform actually failing. */
function describesInfrastructureFault(text: string): boolean {
  const stripped = stripFaultMentions(text);
  return !isCapabilityAttributableFailure(stripped) || ENVIRONMENT_FAILURE_RE.test(stripped);
}

/** Whether a text blames the requirement or plan itself. */
export function describesRequirementDefect(text: string): boolean {
  return REQUIREMENT_DEFECT_RE.test(text);
}

/**
 * Whether a finding is grounded: gating (blocker/major WITH evidence) and not
 * refuted or left undecided by the verifier seat.
 */
function isGroundedFinding(f: RepairFindingLike): boolean {
  if (!f.gating || f.needsCheck) return false;
  if (typeof f.evidence !== 'string' || f.evidence.trim() === '') return false;
  return f.verification !== 'refuted' && f.verification !== 'undetermined';
}

/**
 * A jury bounce is judged on its grounded findings only. The jury reviewed
 * the code, not the environment, so infrastructure does not apply; and a
 * requirement defect is accepted only when EVERY grounded finding blames the
 * requirement — one fixable code defect keeps it with the implementer.
 */
function classifyJuryBounce(findings: RepairFindingLike[] | null | undefined): RepairCauseKind {
  const grounded = (findings ?? []).filter(isGroundedFinding);
  if (grounded.length === 0) return 'unfounded';
  const allRequirement = grounded.every((f) => describesRequirementDefect(f.summary ?? ''));
  return allRequirement ? 'requirements' : 'capability';
}

/**
 * Split a reason into its own statements: the summary, each «quoted» row,
 * and each gate of a gate summary (`typecheck=NG(3) test=NG: ECONNREFUSED …`
 * is a type error AND an environment fault, not just the latter).
 */
function reasonSegments(reason: string): string[] {
  const quoted = [...reason.matchAll(/«([^»]*)»/g)].map((m) => m[1]);
  const head = reason.replace(/未達:\s*(?:«[^»]*»\s*\/?\s*)+/g, ' ').replace(/«[^»]*»/g, ' ');
  return [head, ...quoted].flatMap((s) => s.split(/\s+(?=[a-z][\w-]*=(?:OK|NG)\b)/i));
}

/**
 * Judge a verifier verdict from what it actually says: each statement is an
 * environment fault, a requirement defect, a specific failure of the work, or
 * neither (a bare verdict, a passing row, prose). Infrastructure / requirement
 * only when no specific work failure stands beside them.
 */
function classifyVerdictText(reason: string, verifyContent?: string | null): RepairCauseKind {
  const content = verifyContent?.trim() ? stripNonEvidenceRegions(verifyContent) : '';
  const statements = [...reasonSegments(reason), ...content.split(/\r?\n/)]
    .map((s) => s.trim())
    .filter((s) => s && !/^#/.test(s));
  let infrastructure = 0;
  let requirements = 0;
  let workFailures = 0;
  for (const s of statements) {
    if (PASSING_LINE_RE.test(s)) continue;
    if (describesInfrastructureFault(s)) infrastructure += 1;
    else if (describesRequirementDefect(s)) requirements += 1;
    else if (
      FAILING_LINE_RE.test(s) &&
      !GENERIC_LABEL_LINE_RE.test(s) &&
      s.replace(VERDICT_WORDS_RE, '').length > 2
    ) {
      workFailures += 1;
    }
  }
  if (workFailures > 0) return 'capability';
  if (infrastructure > 0) return 'infrastructure';
  if (requirements > 0) return 'requirements';
  return 'capability';
}

/**
 * Classify one repair bounce by cause.
 *
 * - A jury bounce counts only its grounded findings (see classifyJuryBounce);
 *   without stored findings its grounds cannot be checked, so it is
 *   `unfounded` rather than silently escalating.
 * - Any other verdict (machine gates included) is judged statement by
 *   statement over the reason AND the stored verify.md, because the
 *   validator's summary may be generic.
 * Failure names that are only the subject of code behaviour never count as
 * an infrastructure fault.
 *
 * @param record - The bounce reason, jury findings and verify.md / 差し戻し理由・陪審の指摘・verify.md
 * @returns The cause kind / 原因の種別
 */
export function classifyRepairCause(record: RepairBounceRecord): { kind: RepairCauseKind } {
  const reason = (record.reason ?? '').trim();
  if (!reason) return { kind: 'unfounded' };
  if (reason.startsWith(JURY_BOUNCE_PREFIX)) return { kind: classifyJuryBounce(record.findings) };
  return { kind: classifyVerdictText(reason, record.verifyContent) };
}

/**
 * What a diff-review bounce stores and where it goes: its findings always
 * (so routing can check the grounds), and the planner when every grounded
 * finding blames the requirement or plan (routing2a-fix1 item 4).
 *
 * @param reason - The jury bounce reason / 陪審の差し戻し理由
 * @param findings - Findings as stored (already capped) / 保存する指摘
 * @returns Grounds for attemptVerifyRepair / attemptVerifyRepair に渡す根拠
 */
export function juryBounceGrounds(
  reason: string,
  findings: RepairFindingLike[],
): { findings: RepairFindingLike[]; route: 'implement' | 'replan' } {
  const kind = classifyRepairCause({ reason, findings }).kind;
  return { findings, route: kind === 'requirements' ? 'replan' : 'implement' };
}
