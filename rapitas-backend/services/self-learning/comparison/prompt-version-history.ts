/**
 * PromptVersionHistory
 *
 * Reconstructs a role's prompt "version" timeline from PromptEvolution's
 * existing approve/supersede history (prompt-evolution-worker.ts's
 * reviewProposal) instead of maintaining a parallel multi-version table — the
 * approval lifecycle stays exactly as-is (task #970 plan.md 設計判断の根拠:
 * supersede機構自体は変更しない). Each row's [validFrom, validUntil) window is
 * derived retroactively from when it was approved and when the NEXT approval
 * superseded it, so past AgentExecution rows can be attributed to "whichever
 * prompt was live at the time" without any new write path.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  computeBandEvidence,
  resolveComplexityBand,
  BAND_EVIDENCE_MIN_SAMPLES,
  type ComplexityBand,
} from './prompt-band-evidence';

const log = createLogger('self-learning:prompt-version-history');

/** One historical prompt version and the half-open window it was live for. */
export interface PromptVersion {
  versionId: number;
  content: string;
  validFrom: Date;
  validUntil: Date | null;
}

interface EvidenceStamp {
  approvedAt?: string;
}

function parseApprovedAt(raw: string | null): Date | null {
  try {
    const parsed = raw ? (JSON.parse(raw) as EvidenceStamp) : null;
    const stamp = parsed?.approvedAt ? new Date(parsed.approvedAt) : null;
    return stamp && !Number.isNaN(stamp.getTime()) ? stamp : null;
  } catch {
    return null;
  }
}

/**
 * Reconstruct a role's prompt version timeline, oldest first. Includes
 * `superseded` rows — they ARE the past versions a later approval retired
 * (prompt-evolution-worker.ts's reviewProposal), not dead ends.
 *
 * @param role - Workflow role (e.g. "implementer"). / ワークフローロール
 * @returns Version windows, oldest first; empty when the role has never had an approved addendum. / バージョン履歴
 */
export async function resolvePromptVersionHistory(role: string): Promise<PromptVersion[]> {
  const rows = await prisma.promptEvolution.findMany({
    where: {
      basePromptKey: `workflow_role_${role}`,
      status: { in: ['approved', 'completed', 'superseded'] },
    },
    select: { id: true, afterPrompt: true, evidenceJson: true, createdAt: true },
  });

  const sorted = rows
    .map((r) => ({
      versionId: r.id,
      content: r.afterPrompt,
      validFrom: parseApprovedAt(r.evidenceJson) ?? r.createdAt,
    }))
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

  return sorted.map((v, i) => ({
    ...v,
    validUntil: sorted[i + 1]?.validFrom ?? null,
  }));
}

/**
 * Which version was live at a given execution time.
 *
 * @param executionCreatedAt - AgentExecution.createdAt. / 実行時刻
 * @param history - Version windows from resolvePromptVersionHistory. / バージョン履歴
 * @returns The live version's id, or null when the timestamp predates the first version. / 該当バージョンID
 */
export function resolvePromptVersionForExecution(
  executionCreatedAt: Date,
  history: PromptVersion[],
): number | null {
  for (const v of history) {
    if (
      executionCreatedAt >= v.validFrom &&
      (v.validUntil === null || executionCreatedAt < v.validUntil)
    ) {
      return v.versionId;
    }
  }
  return null;
}

/** Recommendation for which past prompt version best fits a task's difficulty band. */
export interface VersionRecommendation {
  band: ComplexityBand;
  recommendedVersionId: number | null;
  successRate: number | null;
  sampleSize: number;
  confidenceScore: number;
  explorationMode: boolean;
}

function explorationResult(
  band: ComplexityBand,
  best: {
    versionId: number;
    successRate: number;
    sampleSize: number;
    confidenceScore: number;
  } | null,
): VersionRecommendation {
  return {
    band,
    recommendedVersionId: best?.versionId ?? null,
    successRate: best?.successRate ?? null,
    sampleSize: best?.sampleSize ?? 0,
    confidenceScore: best?.confidenceScore ?? 0,
    explorationMode: true,
  };
}

/**
 * Recommend the best-performing past prompt version for a task's difficulty
 * band. Falls back to explorationMode=true (no strong recommendation) when no
 * version's cell in this band has reached BAND_EVIDENCE_MIN_SAMPLES —
 * data-driven exploration gate per plan.md's 探索フェーズの判定方式, not a
 * fixed 3-month calendar window.
 *
 * @param role - Workflow role. / ワークフローロール
 * @param model - Model name to scope the evidence by. / モデル名
 * @param complexityScore - Task.complexityScore (0-100). / タスク複雑度スコア
 * @returns The recommendation, always band+sampleSize populated. / 推薦結果
 */
export async function recommendPromptVersion(
  role: string,
  model: string,
  complexityScore: number,
): Promise<VersionRecommendation> {
  const band = resolveComplexityBand(complexityScore);
  const history = await resolvePromptVersionHistory(role).catch((error) => {
    log.warn({ err: error, role }, 'version history lookup failed (non-fatal)');
    return [] as PromptVersion[];
  });
  if (history.length === 0) return explorationResult(band, null);

  const cells = await Promise.all(
    history.map(async (v) => ({
      versionId: v.versionId,
      evidence: await computeBandEvidence(role, model, band, {
        validFrom: v.validFrom,
        validUntil: v.validUntil,
      }),
    })),
  );

  const eligible = cells.filter((c) => c.evidence.sampleSize >= BAND_EVIDENCE_MIN_SAMPLES);
  const asCandidate = (c: (typeof cells)[number]) => ({
    versionId: c.versionId,
    successRate: 1 - c.evidence.verifyFailureRate,
    sampleSize: c.evidence.sampleSize,
    confidenceScore: c.evidence.confidenceScore,
  });

  if (eligible.length === 0) {
    const mostSampled = cells.reduce<(typeof cells)[number] | null>(
      (best, c) => (best === null || c.evidence.sampleSize > best.evidence.sampleSize ? c : best),
      null,
    );
    return explorationResult(
      band,
      mostSampled && mostSampled.evidence.sampleSize > 0 ? asCandidate(mostSampled) : null,
    );
  }

  const best = eligible.reduce((a, b) =>
    asCandidate(b).successRate > asCandidate(a).successRate ? b : a,
  );
  const winner = asCandidate(best);
  return {
    band,
    recommendedVersionId: winner.versionId,
    successRate: winner.successRate,
    sampleSize: winner.sampleSize,
    confidenceScore: winner.confidenceScore,
    explorationMode: false,
  };
}
