/**
 * PromptEvolutionTreeRoutes
 *
 * Lineage-tree read API for PromptEvolution (task #937): the nested tree
 * (each node carrying the 5 attributes + A/B + treeConfidence) and a manual
 * re-check trigger. Split out of learning.ts (already 223 lines pre-existing;
 * see COMPONENT_SPLITTING_POLICY §2) rather than growing it past the 300-line
 * soft limit. Auto-discovered by generate-route-barrels.cjs via the
 * `*.routes.ts` suffix — no manual barrel edit needed.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  buildPromptEvolutionTree,
  type PromptEvolutionTreeRow,
} from '../../services/self-learning/prompt-evolution-tree';
import { revalidateSingleEvolution } from '../../services/self-learning/prompt-evolution-revalidation-job';

const log = createLogger('routes:prompt-evolution-tree');

/**
 * Load every PromptEvolution row needed to build the tree, optionally scoped
 * to one basePromptKey. Cast via `unknown` — same feature-detection reasoning
 * as prompt-ops.ts: the task #937 columns exist in schema/experiments.prisma
 * but the generated Prisma client is not regenerated until server restart
 * (CLAUDE.md §1).
 *
 * @param basePromptKey - Optional lineage-group filter. / 絞り込み対象のグルーピングキー
 * @returns Raw rows in the shape the tree builder needs. / ツリー構築用の行データ
 */
async function loadTreeRows(basePromptKey?: string): Promise<PromptEvolutionTreeRow[]> {
  const findMany = prisma.promptEvolution.findMany as unknown as (
    args: unknown,
  ) => Promise<PromptEvolutionTreeRow[]>;
  return findMany({
    where: basePromptKey ? { basePromptKey } : undefined,
    select: {
      id: true,
      parentId: true,
      status: true,
      basePromptKey: true,
      taskType: true,
      performanceDelta: true,
      significanceLevel: true,
      applicableConditionsJson: true,
      failureCasesJson: true,
      abTested: true,
      abComparisonRef: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
}

const promptEvolutionTreeRoutes = new Elysia({ prefix: '/learning' })
  /**
   * Lineage tree of every PromptEvolution row (optionally scoped to one
   * basePromptKey), root-first. Each node includes the 5 required attributes
   * (taskType/effect+significance/cost via performanceDelta/applicableConditions/
   * failureCases), abTested, and the derived treeConfidence.
   */
  .get('/prompt-evolution/tree', async ({ query, set }) => {
    try {
      const basePromptKey = (query as { basePromptKey?: string }).basePromptKey;
      const rows = await loadTreeRows(basePromptKey);
      return { roots: buildPromptEvolutionTree(rows) };
    } catch (error) {
      log.error({ err: error }, '[prompt-evolution-tree] failed to build tree');
      set.status = 500;
      return { roots: [] };
    }
  })

  /**
   * Manually re-check one `completed` row for effect regression (bypasses the
   * default-OFF `RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED` gate — an explicit
   * human request always runs).
   */
  .post(
    '/prompt-evolution/:id/revalidate',
    async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      if (!Number.isInteger(id)) {
        set.status = 400;
        return { error: 'id must be an integer' };
      }
      const findUniqueCapablePrisma = prisma as unknown as Parameters<
        typeof revalidateSingleEvolution
      >[0];
      const result = await revalidateSingleEvolution(findUniqueCapablePrisma, id);
      if (result.status === 'not_found') {
        set.status = 404;
        return { error: 'PromptEvolution not found' };
      }
      if (result.status === 'not_applicable') {
        set.status = 409;
        return { error: 'Only completed rows can be revalidated' };
      }
      return {
        status: result.status,
        treeConfidence: result.treeConfidence,
        lastRevalidatedAt: result.lastRevalidatedAt.toISOString(),
      };
    },
    { params: t.Object({ id: t.String() }) },
  );

export default promptEvolutionTreeRoutes;
