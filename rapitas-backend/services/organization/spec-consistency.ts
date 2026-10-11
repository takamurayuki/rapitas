/**
 * spec-consistency
 *
 * Mechanical completeness checks over a generated project's requirements /
 * design / ADR documents, so requirement gaps are found before implementation
 * rather than by a bounced task.
 * Deliberately limited to checks that are decidable from the text: it does not
 * judge whether the product is a good idea, and it never rewrites a document.
 */

import { FEATURE_BULLET, sectionLines } from './requirements-task-plan';

/** How much a finding should block. */
export type SpecFindingSeverity = 'error' | 'warning';

/** One completeness problem found in the document set. */
export interface SpecFinding {
  /** Stable identifier, for UI grouping and tests. / 安定ID */
  code: string;
  severity: SpecFindingSeverity;
  /** Actionable Japanese description. / 対処できる日本語の説明 */
  message: string;
  /** The feature this concerns, when it concerns one. / 該当機能ID */
  featureId?: string;
}

/** The documents to check; any may be missing. */
export interface SpecDocuments {
  requirements?: string | null;
  design?: string | null;
  adr?: string | null;
}

/**
 * Acceptance criteria needed per feature: one normal path, one boundary, one
 * error path.
 *
 * NOTE: Measured 2026-10-11 on TempoRaid — all 12 features shipped with exactly
 * ONE criterion each. The adversarial judge scores a diff against the criteria,
 * so one line per feature means one behaviour verified and the rest left to the
 * implementer's reading; task 1185's agent had to invent its own concurrent-join
 * case because the spec pinned only capacity.
 */
export const MIN_CRITERIA_PER_FEATURE = 3;

/** The section that must exist so unknowns are recorded instead of assumed. */
export const ASSUMPTIONS_SECTION = '前提と未決事項';

/** Feature ids declared in a section, in document order, without duplicates. */
function featureIdsIn(markdown: string, section: string): string[] {
  const seen = new Set<string>();
  for (const line of sectionLines(markdown, section)) {
    const id = line.match(FEATURE_BULLET)?.[1];
    if (id) seen.add(id);
  }
  return [...seen];
}

/** Criteria counted per feature id from the 受け入れ基準 section. */
function criteriaCounts(markdown: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of sectionLines(markdown, '受け入れ基準')) {
    const m = line.match(FEATURE_BULLET);
    if (!m?.[2]?.trim()) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

/** ADR ids a document refers to, e.g. `ADR-0001`. */
function referencedAdrIds(text: string): string[] {
  return [...new Set((text.match(/ADR-\d{4}/g) ?? []).map((s) => s.toUpperCase()))];
}

/** ADR ids the ADR document actually defines (`## ADR-0001: …`). */
function definedAdrIds(adr: string): Set<string> {
  const out = new Set<string>();
  for (const line of adr.split(/\r?\n/)) {
    const m = line.match(/^#{2,}\s*(ADR-\d{4})\b/);
    if (m) out.add(m[1].toUpperCase());
  }
  return out;
}

/**
 * Check one document set for the gaps that cause rework.
 *
 * Every check is decidable from the text alone, so the result is stable and can
 * gate a wizard step. Checks that would need judgement (is this the right
 * architecture?) are deliberately absent — they belong to the review dialogue.
 *
 * @param docs - The generated documents / 生成された文書群
 * @returns Findings, errors first then warnings, feature order preserved / 指摘一覧
 */
export function checkSpecConsistency(docs: SpecDocuments): SpecFinding[] {
  const requirements = docs.requirements ?? '';
  const design = docs.design ?? '';
  const adr = docs.adr ?? '';
  const findings: SpecFinding[] = [];

  if (!requirements.trim()) {
    return [{ code: 'no_requirements', severity: 'error', message: '要件定義書が空です。' }];
  }

  const features = featureIdsIn(requirements, '機能要件');
  if (features.length === 0) {
    findings.push({
      code: 'no_features',
      severity: 'error',
      message:
        '機能要件セクションに `[F-01]` 形式の機能が1件もありません。実装タスクを起票できません。',
    });
  }

  const counts = criteriaCounts(requirements);
  for (const id of features) {
    const n = counts.get(id) ?? 0;
    if (n === 0) {
      findings.push({
        code: 'missing_criteria',
        severity: 'error',
        featureId: id,
        message: `[${id}] に受け入れ基準がありません。判定できない機能は実装タスクにできません。`,
      });
    } else if (n < MIN_CRITERIA_PER_FEATURE) {
      findings.push({
        code: 'too_few_criteria',
        severity: 'warning',
        featureId: id,
        message:
          `[${id}] の受け入れ基準が ${n} 件です。正常系・境界・異常系で ` +
          `${MIN_CRITERIA_PER_FEATURE} 件以上にしてください（1件だと1つの振る舞いしか検証されません）。`,
      });
    }
  }

  // A criterion for a feature that no longer exists means the two sections
  // drifted; the filer would never see it and nobody would notice.
  for (const id of counts.keys()) {
    if (!features.includes(id)) {
      findings.push({
        code: 'orphan_criteria',
        severity: 'error',
        featureId: id,
        message: `[${id}] の受け入れ基準がありますが、機能要件に [${id}] がありません。`,
      });
    }
  }

  // Traceability: a feature with no surface in the design has no API, data
  // model or screen behind it, so the implementer has to invent one.
  if (design.trim()) {
    for (const id of features) {
      if (!design.includes(id)) {
        findings.push({
          code: 'untraced_feature',
          severity: 'warning',
          featureId: id,
          message: `[${id}] が設計書に一度も現れません。対応する API・データモデル・画面を設計に書いてください。`,
        });
      }
    }
  } else {
    findings.push({
      code: 'no_design',
      severity: 'warning',
      message: '設計書が空です。機能要件と設計の対応が検証できません。',
    });
  }

  if (sectionLines(requirements, ASSUMPTIONS_SECTION).length === 0) {
    findings.push({
      code: 'missing_assumptions_section',
      severity: 'error',
      message:
        `要件定義書に \`# ${ASSUMPTIONS_SECTION}\` セクションがありません。` +
        'ヒアリングしていない数値や未決の仕様は、暗黙の仮定にせずここに書き出してください。',
    });
  }

  // A decision referenced but never written down is the same gap the ADR exists
  // to close: the next reader cannot find out why.
  const defined = definedAdrIds(adr);
  for (const id of referencedAdrIds(`${requirements}\n${design}`)) {
    if (!defined.has(id)) {
      findings.push({
        code: 'dangling_adr_ref',
        severity: 'warning',
        message: `${id} が参照されていますが、技術選定記録に ${id} の項がありません。`,
      });
    }
  }

  // The prompt forbids leaving a choice open ("A または B"); check the one
  // section where it matters, so the ambiguity does not reach the implementer.
  for (const line of sectionLines(design, '技術スタック')) {
    if (/または|もしくは/.test(line)) {
      findings.push({
        code: 'vague_tech_choice',
        severity: 'warning',
        message: `技術スタックに選択肢が残っています: ${line.trim().slice(0, 80)}`,
      });
    }
  }

  return [
    ...findings.filter((f) => f.severity === 'error'),
    ...findings.filter((f) => f.severity === 'warning'),
  ];
}

/**
 * Whether the document set is complete enough to start implementing.
 *
 * @param findings - Result of checkSpecConsistency / 検査結果
 * @returns true when no error-severity finding remains / error が無ければ true
 */
export function specIsImplementable(findings: readonly SpecFinding[]): boolean {
  return !findings.some((f) => f.severity === 'error');
}
