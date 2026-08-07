/**
 * critic-rejection-guard
 *
 * Shared predicate for every artifact-harvest path: has the phase critic
 * REJECTED this phase's artifact since the phase started? Re-saving the
 * agent's final message after a rejection resurrects the bounced content
 * byte-for-byte and flips the workflow status forward again, silently
 * nullifying the critic gate. Task 539 hit this through the manual-execution
 * harvest (research-phase-handler), which lacked the guard the auto-run
 * executor already had.
 */
import { createHash } from 'crypto';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { sanitizeMarkdownContent } from '../../../utils/common/mojibake-detector';

const log = createLogger('critic-rejection-guard');

/**
 * Check whether the phase critic recorded a rejection for this artifact
 * after the given instant.
 *
 * Fail-open: a DB error returns false (allow the save) because blocking every
 * harvest on a transient DB failure would strand phases with no artifact at
 * all — the critic can bounce the artifact again on the next pass.
 *
 * @param taskId - Task whose artifact is about to be saved. / 保存対象タスクID
 * @param fileType - Workflow file type being saved. / 保存するファイル種別
 * @param since - Phase start (or execution start) boundary. / フェーズ開始時刻
 * @returns true when a `<fileType>_critic_failed` transition exists after `since`. / 差し戻し済みならtrue
 */
export async function criticRejectedSince(
  taskId: number,
  fileType: string,
  since: Date,
): Promise<boolean> {
  // Only research/plan pass through the phase critic; other file types never
  // have a rejection to resurrect.
  if (fileType !== 'research' && fileType !== 'plan') return false;
  try {
    const hit = await prisma.workflowTransition.findFirst({
      where: {
        taskId,
        cause: `${fileType}_critic_failed`,
        createdAt: { gt: since },
      },
      select: { id: true },
    });
    if (hit) {
      log.warn(
        { taskId, fileType, since: since.toISOString() },
        '[critic-rejection-guard] Artifact was rejected by the phase critic after phase start — harvest save must be skipped',
      );
    }
    return !!hit;
  } catch (err) {
    log.warn(
      { err, taskId, fileType },
      '[critic-rejection-guard] Transition lookup failed — failing open (allowing save)',
    );
    return false;
  }
}

/** Result of the identical-resave check. */
export interface RejectedResaveVerdict {
  isResave: boolean;
  reasons: string[];
  severity: number | null;
}

const NOT_A_RESAVE: RejectedResaveVerdict = { isResave: false, reasons: [], severity: null };

/**
 * Detect a byte-identical re-submission of an artifact the phase critic just
 * rejected. The harvest guards cover server-side re-saves, but the agent
 * itself can PUT its buffered report again through the HTTP API (the front
 * door) after the async verdict landed — observed on tasks 539/540 as a
 * same-hash resurrection minutes after the rollback. The rejected content is
 * always the LATEST WorkflowFileVersion (the rollback archives it), so an
 * incoming save that (a) arrives while the live row is still absent and
 * (b) hashes to that version's sha256 is the rejected artifact verbatim.
 *
 * Fail-open: any lookup error returns isResave=false so a DB hiccup cannot
 * block legitimate saves.
 *
 * @param taskId - Task whose artifact is being saved. / 保存対象タスクID
 * @param fileType - Workflow file type being saved. / 保存するファイル種別
 * @param incomingContent - Raw content from the save request. / 保存リクエストの本文
 * @returns Verdict with the critic's original reasons when it is a resave. / 再提出なら差し戻し理由付きで返す
 */
export async function checkRejectedResave(
  taskId: number,
  fileType: string,
  incomingContent: string,
): Promise<RejectedResaveVerdict> {
  if (fileType !== 'research' && fileType !== 'plan') return NOT_A_RESAVE;
  try {
    const live = await prisma.workflowFile.findUnique({
      where: { taskId_fileType: { taskId, fileType } },
      select: { id: true },
    });
    // A live row means the rejected artifact was already replaced (or never
    // archived) — a duplicate save of CURRENT content is harmless idempotence.
    if (live) return NOT_A_RESAVE;

    const lastVersion = await prisma.workflowFileVersion.findFirst({
      where: { taskId, fileType },
      orderBy: { archivedAt: 'desc' },
      select: { sha256: true, archivedAt: true },
    });
    if (!lastVersion) return NOT_A_RESAVE;

    // Same sanitiser as writeWorkflowFile so the hash comparison is
    // byte-for-byte against what was stored.
    const sanitized = sanitizeMarkdownContent(incomingContent).content;
    const incomingSha = createHash('sha256').update(sanitized).digest('hex');
    if (incomingSha !== lastVersion.sha256) return NOT_A_RESAVE;

    // The archive and the rejection transition are written together during
    // rollback; require the rejection to sit at/after the archived version
    // (60s slack for clock ordering) so an old unrelated version can't match.
    const rejection = await prisma.workflowTransition.findFirst({
      where: {
        taskId,
        cause: `${fileType}_critic_failed`,
        createdAt: { gte: new Date(lastVersion.archivedAt.getTime() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (!rejection) return NOT_A_RESAVE;

    let reasons: string[] = [];
    let severity: number | null = null;
    try {
      const meta =
        typeof rejection.metadata === 'string'
          ? (JSON.parse(rejection.metadata) as Record<string, unknown>)
          : ((rejection.metadata ?? {}) as Record<string, unknown>);
      if (Array.isArray(meta.reasons)) {
        reasons = meta.reasons.filter((r): r is string => typeof r === 'string');
      }
      if (typeof meta.severity === 'number') severity = meta.severity;
    } catch {
      // metadata parse failure — still a resave, just without reasons
    }
    log.warn(
      { taskId, fileType, sha256: incomingSha },
      '[critic-rejection-guard] Byte-identical resave of a critic-rejected artifact detected',
    );
    return { isResave: true, reasons, severity };
  } catch (err) {
    log.warn(
      { err, taskId, fileType },
      '[critic-rejection-guard] Resave check failed — failing open (allowing save)',
    );
    return NOT_A_RESAVE;
  }
}
