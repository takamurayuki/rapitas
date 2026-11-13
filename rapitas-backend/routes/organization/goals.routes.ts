/**
 * goals routes
 *
 * Read API for the goal screens: every goal (project) with its reach rate,
 * and one goal with its milestones (節目), their criteria and task counts.
 * Thin layer — shaping and counting live in services/goals. Writes go
 * through /projects and /milestones as before.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';
import { isValidEntityId } from '../../utils/common/id-validation';
import { MILESTONE_ORDER, toGoalDetail, toGoalSummary } from '../../services/goals';

/** Only the task fields the counts need, top-level tasks only (subtasks are part of their parent). */
const MILESTONE_TASKS = { where: { parentId: null }, select: { status: true } } as const;

const goalsRoutes = new Elysia({ prefix: '/goals' })
  /** Every goal with its reach rate and next open milestone. */
  .get('/', async () => {
    const projects = await prisma.project.findMany({
      include: {
        milestones: { orderBy: MILESTONE_ORDER },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map(toGoalSummary);
  })

  /** One goal with its milestones in order. */
  .get(
    '/:id',
    async ({ params }) => {
      if (!isValidEntityId(params.id)) throw new ValidationError('無効なIDです');
      const project = await prisma.project.findUnique({
        where: { id: Number(params.id) },
        include: {
          milestones: { orderBy: MILESTONE_ORDER, include: { tasks: MILESTONE_TASKS } },
          _count: { select: { tasks: true } },
          tasks: { where: { milestoneId: null, parentId: null }, select: { id: true } },
        },
      });
      if (!project) throw new NotFoundError('ゴールが見つかりません');
      return toGoalDetail(project, project.tasks.length);
    },
    { params: t.Object({ id: t.String() }) },
  );

export default goalsRoutes;
