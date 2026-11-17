/**
 * Idea Tidy Routes
 *
 * ラピ's idea-box tidy over HTTP: the proposal, applying what the person
 * confirmed, and undoing it. Nothing changes on the proposal; applying
 * archives, so undo restores. Not responsible for the proposal rules
 * (services/memory/idea-tidy.ts).
 */
import { Elysia, t } from 'elysia';
import { applyIdeaTidy, proposeIdeaTidy, undoIdeaTidy } from '../../services/memory/idea-tidy';

/** Upper bound on ids in one request, so a body cannot be a table dump. */
const MAX_IDS = 400;

const ids = t.Array(t.Integer({ minimum: 1 }), { maxItems: MAX_IDS });

export const ideaTidyRoutes = new Elysia({ prefix: '/idea-box/tidy' })
  /** What ラピ proposes; reads only. */
  .get(
    '/proposal',
    async ({ query }) => {
      const themeId = query.themeId ? Number(query.themeId) : undefined;
      const plan = await proposeIdeaTidy(
        themeId !== undefined && Number.isSafeInteger(themeId) && themeId > 0 ? themeId : undefined,
      );
      return { success: true, ...plan };
    },
    { query: t.Object({ themeId: t.Optional(t.String({ pattern: '^\\d+$' })) }) },
  )

  /** Apply what the person confirmed. */
  .post(
    '/',
    async ({ body }) => {
      const done = await applyIdeaTidy({
        merges: body.merges ?? [],
        archiveIds: body.archiveIds ?? [],
      });
      return { success: true, ...done };
    },
    {
      body: t.Object({
        merges: t.Optional(
          t.Array(t.Object({ keepId: t.Integer({ minimum: 1 }), mergeIds: ids }), {
            maxItems: MAX_IDS,
          }),
        ),
        archiveIds: t.Optional(ids),
      }),
    },
  )

  /** Undo an applied tidy with what it returned. */
  .post(
    '/undo',
    async ({ body }) => {
      await undoIdeaTidy(body);
      return { success: true };
    },
    {
      body: t.Object({
        archivedIds: ids,
        previousContents: t.Array(
          t.Object({ id: t.Integer({ minimum: 1 }), content: t.String() }),
          { maxItems: MAX_IDS },
        ),
      }),
    },
  );

export default ideaTidyRoutes;
