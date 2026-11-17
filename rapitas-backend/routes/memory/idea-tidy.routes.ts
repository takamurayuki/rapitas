/**
 * Idea Tidy Routes
 *
 * ラピ's idea-box tidy over HTTP: the proposal, applying what the person
 * confirmed, and undoing it. Nothing changes on the proposal; applying
 * archives, so undo restores. Not responsible for the proposal rules
 * (services/memory/idea-tidy.ts).
 */
import { Elysia, t } from 'elysia';
import {
  applyIdeaTidy,
  loadActiveIdeas,
  proposeIdeaTidy,
  undoIdeaTidy,
} from '../../services/memory/idea-tidy';
import { judgeIdeaTidy } from '../../services/memory/idea-tidy-judgement';

/** Upper bound on ids in one request, so a body cannot be a table dump. */
const MAX_IDS = 400;

const ids = t.Array(t.Integer({ minimum: 1 }), { maxItems: MAX_IDS });

export const ideaTidyRoutes = new Elysia({ prefix: '/idea-box/tidy' })
  /**
   * What ラピ proposes; reads only. `mode=judgement` (おまかせ) has the model
   * read the ideas; without it the rules decide.
   */
  .get(
    '/proposal',
    async ({ query }) => {
      const raw = query.themeId ? Number(query.themeId) : undefined;
      const themeId = raw !== undefined && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
      if (query.mode === 'judgement') {
        const judged = await judgeIdeaTidy(await loadActiveIdeas(themeId));
        // A model that said nothing usable is not "nothing to tidy".
        return judged
          ? { success: true, available: true, ...judged }
          : { success: true, available: false, duplicates: [], unneeded: [] };
      }
      return { success: true, ...(await proposeIdeaTidy(themeId)) };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String({ pattern: '^\\d+$' })),
        mode: t.Optional(t.Union([t.Literal('rules'), t.Literal('judgement')])),
      }),
    },
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
