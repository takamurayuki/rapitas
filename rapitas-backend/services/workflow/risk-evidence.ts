/**
 * risk-evidence
 *
 * Decides the routing risk floor from EVIDENCE produced by the workflow itself —
 * the research agent's own verdict and the files a plan declares it will change —
 * instead of keyword-matching the task's prose.
 *
 * Rationale (measured 2026-08-25): across every routing decision that recorded a
 * driver, the complexity signal never once selected a premium model, while the
 * prose keyword floor selected one 31 times — and each instance inspected was a
 * false positive (「解決済み」read as 決済, 「セキュリティでもなく」, a schema path in
 * a row that said 足さない, a pasted log). The repo already applies the
 * "a-priori guess before research, measured value after" rule to complexity
 * (see research-complexity.ts); this applies the same rule to risk.
 *
 * NOT responsible for the pre-research case: with no artifacts there is no
 * evidence, so callers fall back to the keyword detector.
 */

import { parsePlanFiles } from '../agents/verification/scope-check';
import { stripRuledOutLines } from './routing-policy';
import { parseResearchRisk } from './research-risk';

/** Backslash, built without an escape so heredoc/codegen cannot mangle it. */
const BACKSLASH = String.fromCharCode(92);

/** Path segments whose presence in a DECLARED change target means real risk. */
const RISKY_SEGMENTS = new Set(['migrations', 'auth', 'payment', 'billing', 'security']);

/** Basename prefixes that carry the same meaning (auth-guard.ts, payment.service.ts). */
const RISKY_BASENAME_PREFIXES = ['auth', 'payment', 'billing'];

/**
 * Whether a path a plan declared it will change is itself high-risk.
 *
 * Deliberately structural — segments and basenames, never prose — so a mention
 * in a sentence cannot reach it.
 *
 * @param raw - A path or directory prefix from the plan. / plan が挙げたパス
 * @returns True when the target is a high-risk file. / 高リスク対象なら true
 */
export function isRiskyDeclaredPath(raw: string): boolean {
  const p = raw.split(BACKSLASH).join('/').toLowerCase();
  if (p.includes('prisma/schema') || p.endsWith('.prisma')) return true;

  const segments = p.split('/').filter(Boolean);
  if (segments.some((s) => RISKY_SEGMENTS.has(s))) return true;

  const basename = segments[segments.length - 1] ?? '';
  return RISKY_BASENAME_PREFIXES.some(
    (w) => basename === w || basename.startsWith(w + '-') || basename.startsWith(w + '.'),
  );
}

/** Where a risk verdict came from, so the decision stays auditable. */
export type RiskEvidenceSource = 'research_verdict' | 'declared_files' | 'evidence_clear';

/** An evidence-backed risk decision. */
export interface RiskEvidence {
  high: boolean;
  reason: string;
  source: RiskEvidenceSource;
  /** Declared paths that triggered a `declared_files` verdict. / 発火したパス */
  files?: string[];
}

/**
 * Resolve the risk floor from workflow artifacts.
 *
 * A HIGH verdict from either source wins: the research agent may know an area is
 * sensitive before the plan names a file, and a plan may declare a schema file
 * the research prose never mentioned. A LOW result is only returned once at
 * least one artifact exists — absence of evidence is not evidence of safety.
 *
 * @param input.researchContent - research.md body, when saved. / research.md 本文
 * @param input.planContent - plan.md body, when saved. / plan.md 本文
 * @returns The decision, or null when no artifact exists yet. / 判定、証拠が無ければ null
 */
export function resolveRiskFromEvidence(input: {
  researchContent?: string | null;
  planContent?: string | null;
}): RiskEvidence | null {
  const research = input.researchContent ?? null;
  const plan = input.planContent ?? null;
  if (!research && !plan) return null;

  const verdict = parseResearchRisk(research);

  // parsePlanFiles captures EVERY backticked path, including one named in a row
  // that decided not to touch it — task 658 listed `prisma/schema/memory.prisma`
  // in a 検討事項 row answered 「足さない」. Blank those lines first so a declined
  // target cannot be read as a declared one.
  const declared = plan ? parsePlanFiles(stripRuledOutLines(plan)) : [];
  const riskyFiles = declared.filter(isRiskyDeclaredPath);

  if (riskyFiles.length > 0) {
    return {
      high: true,
      reason: `plan declares high-risk change targets (${riskyFiles.slice(0, 3).join(', ')})`,
      source: 'declared_files',
      files: riskyFiles,
    };
  }

  if (verdict?.high) {
    const areas = verdict.areas.length > 0 ? verdict.areas.join('/') : 'unspecified';
    return {
      high: true,
      reason: `research assessed the work as high-risk (${areas})`,
      source: 'research_verdict',
    };
  }

  // Evidence exists and none of it says high. Only trust that once an artifact
  // we can actually read is present — a plan with no declared paths tells us
  // nothing, so it must not silently clear the floor.
  const usable = verdict !== null || declared.length > 0;
  if (!usable) return null;

  return {
    high: false,
    reason: 'no high-risk change target declared by research or plan',
    source: 'evidence_clear',
  };
}
