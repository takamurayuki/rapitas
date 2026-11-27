/**
 * goal-reflection-router
 *
 * Router factory for the weekly 前進の振り返り: save one goal's reflection,
 * read its trend, and read/write the day and time of the weekly nudge. Thin
 * layer over services/goals; the factory takes its database and clock so tests
 * need neither Prisma nor real time.
 */
import { Elysia, t } from 'elysia';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';
import { isValidEntityId } from '../../utils/common/id-validation';
import {
  listReflections,
  saveReflection,
  type ReflectionDb,
} from '../../services/goals/goal-reflection';
import {
  readPromptSettings,
  writePromptSettings,
} from '../../services/goals/reflection-prompt-settings';
import type { SettingsDb } from '../../services/goals/reflection-prompt-settings';

const REFUSAL_MESSAGES: Record<string, string> = {
  reflection_rating_invalid: '評価は1〜5の整数で選んでください',
  reflection_note_invalid: '一言は文字列で入力してください',
  reflection_note_too_long: '一言は500文字までです',
  reflection_week_invalid: '指定できない週です',
};

function goalId(raw: string): number {
  if (!isValidEntityId(raw)) throw new ValidationError('無効なIDです');
  return Number(raw);
}

/**
 * Build the goal reflection routes.
 *
 * @param db - Prisma slice the services use / DB
 * @param clock - Current time provider / 現在時刻
 * @returns The Elysia router / ルーター
 */
export function createGoalReflectionRouter(
  db: ReflectionDb & SettingsDb,
  clock: () => Date = () => new Date(),
) {
  return (
    new Elysia()
      /** Save (create or correct) the goal's reflection for a week; the current week by default. */
      .put(
        '/goals/:id/reflections',
        async ({ params, body }) => {
          const result = await saveReflection(db, {
            projectId: goalId(params.id),
            rating: body.rating,
            note: body.note,
            weekStart: body.weekStart,
            now: clock(),
          });
          if (result.ok) return result.item;
          if (result.code === 'reflection_goal_not_found')
            throw new NotFoundError('ゴールが見つかりません');
          throw new ValidationError(REFUSAL_MESSAGES[result.code], result.code);
        },
        {
          params: t.Object({ id: t.String() }),
          // NOTE: rating and note stay loosely typed here so the service is the single
          // place that judges them and every refusal carries the same code.
          body: t.Object({
            rating: t.Unknown(),
            note: t.Optional(t.Unknown()),
            weekStart: t.Optional(t.String()),
          }),
        },
      )

      /** The goal's trend: one item per week, oldest first. */
      .get(
        '/goals/:id/reflections',
        async ({ params }) => {
          const result = await listReflections(db, goalId(params.id));
          if (!result.ok) throw new NotFoundError('ゴールが見つかりません');
          return result.items;
        },
        { params: t.Object({ id: t.String() }) },
      )

      /** Day and time of the weekly nudge (default Sunday 20:00, Asia/Tokyo). */
      .get('/goal-reflections/settings', () => readPromptSettings(db))
      .put(
        '/goal-reflections/settings',
        async ({ body }) => {
          const saved = await writePromptSettings(db, body);
          if (!saved) throw new ValidationError('曜日は0〜6、時刻は HH:MM で指定してください');
          return saved;
        },
        { body: t.Object({ dow: t.Unknown(), time: t.Unknown() }) },
      )
  );
}
