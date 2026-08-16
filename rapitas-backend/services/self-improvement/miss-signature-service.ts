/**
 * miss-signature-service
 *
 * Review lifecycle + aggregation for miss-signature suggestions: pending
 * listing, human approve/reject (with the reviewProposal-style status guard),
 * window stats feeding the stateless approval-mode derivation, and the
 * knowledge-base sink for approved/auto-applied cues. The sink writes a
 * KnowledgeEntry ONLY — no task, no concern, no dynamic rule execution
 * (auto-apply must stay non-destructive; a false positive here costs nothing
 * downstream).
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveSelfDevelopmentThemeId } from '../workflow/self-development-theme';
import {
  readMissApprovalConfig,
  resolveApprovalMode,
  type MissApprovalDecision,
} from './miss-approval-mode';

const log = createLogger('self-improvement:miss-signature-service');

/** KnowledgeEntry.sourceType for applied miss signatures. */
export const MISS_SIGNATURE_SOURCE_TYPE = 'miss_signature';

/** Max pending suggestions promoted per auto-apply run (noise bound). */
const AUTO_APPLY_BATCH = 5;

/** A suggestion row as the API/UI consumes it. */
export interface MissSuggestionView {
  id: number;
  caseId: number | null;
  signature: string;
  explanation: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface MissSummary {
  decision: MissApprovalDecision;
  counts: {
    pendingReview: number;
    approved: number;
    rejected: number;
    autoApplied: number;
    cases: number;
  };
  window: {
    days: number;
    samples: number;
    rejections: number;
  };
}

/**
 * List suggestions by status (default: the review queue, oldest first).
 *
 * @param status - Status filter (default pending_review). / 状態フィルタ
 * @returns Suggestion rows. / 提案一覧
 */
export async function listSuggestions(status = 'pending_review'): Promise<MissSuggestionView[]> {
  return prisma.missSignatureSuggestion.findMany({
    where: { status },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      caseId: true,
      signature: true,
      explanation: true,
      status: true,
      reviewedBy: true,
      reviewedAt: true,
      createdAt: true,
    },
  });
}

/** Writes one applied cue into the knowledge base (idempotent by contentHash). */
async function writeSignatureKnowledge(suggestion: {
  caseId: number | null;
  signature: string;
  explanation: string;
  dedupKey: string;
}): Promise<void> {
  const contentHash = createHash('sha256')
    .update(`miss-signature:${suggestion.dedupKey}`)
    .digest('hex');
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash, sourceType: MISS_SIGNATURE_SOURCE_TYPE },
    select: { id: true },
  });
  if (existing) return;

  const missCase =
    suggestion.caseId !== null
      ? await prisma.detectionMissCase
          .findUnique({
            where: { id: suggestion.caseId },
            select: { taskId: true, gate: true, reason: true },
          })
          .catch(() => null)
      : null;

  // These cues are about rapitas' own quality gates — file them under the
  // self-development theme (same reasoning as the incident watcher).
  const themeId = await resolveSelfDevelopmentThemeId();
  await prisma.knowledgeEntry.create({
    data: {
      sourceType: MISS_SIGNATURE_SOURCE_TYPE,
      sourceId: suggestion.dedupKey,
      title: `[検出漏れ兆候] ${suggestion.signature}`.slice(0, 200),
      content: [
        `## 兆候`,
        suggestion.signature,
        '',
        `## 説明`,
        suggestion.explanation,
        '',
        `## 出典事例`,
        missCase
          ? `- ゲート: ${missCase.gate} / タスク: #${missCase.taskId}\n- 素通し理由: ${missCase.reason}`
          : '- (事例リンクなし)',
      ].join('\n'),
      contentHash,
      category: 'pattern',
      tags: JSON.stringify(['source:miss_signature_learning']),
      confidence: 0.6,
      themeId,
      taskId: missCase?.taskId ?? null,
      forgettingStage: 'active',
      decayScore: 1.0,
      validationStatus: 'pending',
    },
  });
}

/**
 * Record a human verdict on a suggestion. Status guard (reviewProposal
 * pattern): pending_review accepts approve or reject; auto_applied accepts
 * ONLY reject — the correction path that re-enters the rejection window and
 * can flip the mode back to manual. Everything else (double review) → false.
 *
 * @param id - Suggestion row id. / 対象ID
 * @param approved - true=approve, false=reject. / 承認するか
 * @returns Whether the row existed and was reviewable. / 更新できたか
 */
export async function reviewSuggestion(id: number, approved: boolean): Promise<boolean> {
  const row = await prisma.missSignatureSuggestion.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      caseId: true,
      signature: true,
      explanation: true,
      dedupKey: true,
    },
  });
  if (!row) return false;
  const reviewable =
    row.status === 'pending_review' || (row.status === 'auto_applied' && !approved);
  if (!reviewable) return false;

  await prisma.missSignatureSuggestion.update({
    where: { id },
    data: {
      status: approved ? 'approved' : 'rejected',
      reviewedBy: 'human',
      reviewedAt: new Date(),
    },
  });

  if (approved) {
    // Sink failures must not undo the verdict — log and continue.
    await writeSignatureKnowledge(row).catch((err) =>
      log.warn({ err, id }, '[miss-signature] knowledge sink failed after approval'),
    );
  }
  log.info({ id, approved }, '[miss-signature] suggestion reviewed');
  return true;
}

/** Counts human verdicts (all-time + trailing window) for the mode derivation. */
async function countReviewStats(windowDays: number, nowMs: number) {
  const since = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000);
  const humanReviewed = { reviewedBy: 'human', status: { in: ['approved', 'rejected'] } };
  const [totalHumanReviews, windowSamples, windowRejections] = await Promise.all([
    prisma.missSignatureSuggestion.count({ where: humanReviewed }),
    prisma.missSignatureSuggestion.count({
      where: { ...humanReviewed, reviewedAt: { gte: since } },
    }),
    prisma.missSignatureSuggestion.count({
      where: { reviewedBy: 'human', status: 'rejected', reviewedAt: { gte: since } },
    }),
  ]);
  return { totalHumanReviews, windowSamples, windowRejections };
}

/**
 * Aggregate the current approval mode, verdict counts and queue sizes.
 *
 * @param nowMs - Anchor time (injectable for tests). / 基準時刻
 * @returns The summary the UI and the job consume. / 集計サマリ
 */
export async function getMissSummary(nowMs: number = Date.now()): Promise<MissSummary> {
  const cfg = readMissApprovalConfig();
  const stats = await countReviewStats(cfg.windowDays, nowMs);
  const decision = resolveApprovalMode(stats, cfg);

  const [pendingReview, approved, rejected, autoApplied, cases] = await Promise.all([
    prisma.missSignatureSuggestion.count({ where: { status: 'pending_review' } }),
    prisma.missSignatureSuggestion.count({ where: { status: 'approved' } }),
    prisma.missSignatureSuggestion.count({ where: { status: 'rejected' } }),
    prisma.missSignatureSuggestion.count({ where: { status: 'auto_applied' } }),
    prisma.detectionMissCase.count(),
  ]);

  return {
    decision,
    counts: { pendingReview, approved, rejected, autoApplied, cases },
    window: {
      days: cfg.windowDays,
      samples: stats.windowSamples,
      rejections: stats.windowRejections,
    },
  };
}

/**
 * Promote pending suggestions to auto_applied and sink them into the
 * knowledge base. The CALLER must have derived mode='auto' first — this
 * function re-derives and refuses otherwise (defense in depth so a stale
 * caller can never auto-apply in manual mode).
 *
 * @param nowMs - Anchor time (injectable for tests). / 基準時刻
 * @returns Number of suggestions auto-applied. / 自動反映件数
 */
export async function applyPendingAutomatically(nowMs: number = Date.now()): Promise<number> {
  const summary = await getMissSummary(nowMs);
  if (summary.decision.mode !== 'auto') {
    log.debug(
      { basis: summary.decision.basis },
      '[miss-signature] auto-apply refused — mode is manual',
    );
    return 0;
  }

  const pending = await prisma.missSignatureSuggestion.findMany({
    where: { status: 'pending_review' },
    orderBy: { createdAt: 'asc' },
    take: AUTO_APPLY_BATCH,
    select: { id: true, caseId: true, signature: true, explanation: true, dedupKey: true },
  });

  let applied = 0;
  for (const row of pending) {
    try {
      await prisma.missSignatureSuggestion.update({
        where: { id: row.id },
        data: { status: 'auto_applied', reviewedBy: 'auto', reviewedAt: new Date(nowMs) },
      });
      await writeSignatureKnowledge(row).catch((err) =>
        log.warn({ err, id: row.id }, '[miss-signature] knowledge sink failed after auto-apply'),
      );
      applied++;
    } catch (err) {
      log.warn({ err, id: row.id }, '[miss-signature] auto-apply failed — continuing');
    }
  }
  if (applied > 0) {
    log.info(
      { applied },
      '[miss-signature] suggestions auto-applied (rejection rate under threshold)',
    );
  }
  return applied;
}
