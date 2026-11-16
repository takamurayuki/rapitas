/**
 * milestone-achievement routes
 *
 * The only way a milestone (節目) becomes `reached`: the person ticks every
 * agreed criterion and writes why (POST /milestones/:id/confirm). Reopening
 * undoes it. The rules live in services/goals/milestone-achievement; PATCH
 * /milestones/:id cannot set `reached` on its own.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/error-handler';
import { isValidEntityId } from '../../utils/common/id-validation';
import { checkConfirmation, parseMilestoneCriteria, toMilestoneView } from '../../services/goals';

const REFUSAL_MESSAGES: Record<string, string> = {
  milestone_criteria_required: '達成条件が決まっていない節目は、達成を確認できません',
  milestone_criteria_unchecked: 'すべての達成条件を確認してください',
  milestone_criteria_changed: '達成条件が変わりました。開き直してから確認してください',
  milestone_evidence_required: '達成の根拠を書いてください',
  milestone_already_reached: 'この節目はすでに達成済みです',
};

async function loadMilestone(rawId: string) {
  if (!isValidEntityId(rawId)) throw new ValidationError('無効なIDです');
  const milestone = await prisma.milestone.findUnique({ where: { id: Number(rawId) } });
  if (!milestone) throw new NotFoundError('節目が見つかりません');
  return milestone;
}

const milestoneAchievementRoutes = new Elysia({ prefix: '/milestones' })
  /** Confirm the milestone as reached, with every criterion checked and the evidence. */
  .post(
    '/:id/confirm',
    async ({ params, body }) => {
      const milestone = await loadMilestone(params.id);
      const verdict = checkConfirmation({
        status: milestone.status,
        criteria: parseMilestoneCriteria(milestone.acceptanceCriteria),
        checkedCriteria: body.checkedCriteria,
        evidence: body.evidence,
      });
      if (!verdict.ok) throw new ConflictError(REFUSAL_MESSAGES[verdict.code], verdict.code);
      const updated = await prisma.milestone.update({
        where: { id: milestone.id },
        data: { status: 'reached', evidence: verdict.evidence, reachedAt: new Date() },
      });
      return toMilestoneView(updated);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        checkedCriteria: t.Array(t.String({ maxLength: 500 }), { maxItems: 10 }),
        evidence: t.String({ maxLength: 5000 }),
      }),
    },
  )

  /** Undo a confirmation: the milestone is open again and its evidence is cleared. */
  .post(
    '/:id/reopen',
    async ({ params }) => {
      const milestone = await loadMilestone(params.id);
      const updated = await prisma.milestone.update({
        where: { id: milestone.id },
        data: { status: 'open', evidence: null, reachedAt: null },
      });
      return toMilestoneView(updated);
    },
    { params: t.Object({ id: t.String() }) },
  );

export default milestoneAchievementRoutes;
