/**
 * IdeaBox API Routes
 *
 * CRUD endpoints for the IdeaBox feature. Ideas are improvement suggestions
 * collected from agent execution, copilot chat, and manual user input.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  listIdeas,
  submitIdea,
  updateIdea,
  deleteIdea,
  getIdeaStats,
  markIdeaAsUsed,
} from '../../services/memory/idea-box-service';
import { runInnovationSession } from '../../services/memory/innovation-session';
import { prisma } from '../../config/database';
import { createTask } from '../../services/task/task-mutations';

const log = createLogger('routes:idea-box');

export const ideaBoxRoutes = new Elysia()

  /** List ideas with optional filters. */
  .get(
    '/idea-box',
    async ({ query }) => {
      const categoryId = query.categoryId ? parseInt(query.categoryId) : undefined;
      const themeId = query.themeId ? parseInt(query.themeId) : undefined;
      const unusedOnly = query.unusedOnly === 'true';
      const scope = query.scope as 'global' | 'project' | undefined;
      const limit = query.limit ? parseInt(query.limit) : 20;
      const offset = query.offset ? parseInt(query.offset) : 0;

      const result = await listIdeas({ categoryId, themeId, unusedOnly, scope, limit, offset });
      return result;
    },
    {
      query: t.Object({
        categoryId: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        unusedOnly: t.Optional(t.String()),
        scope: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  /** Submit a new idea manually. */
  .post(
    '/idea-box',
    async ({ body, set }) => {
      if (!body.title?.trim() || !body.content?.trim()) {
        set.status = 400;
        return { error: 'タイトルと内容は必須です' };
      }

      try {
        const id = await submitIdea({
          title: body.title.trim(),
          content: body.content.trim(),
          category: body.category ?? 'improvement',
          scope: (body.scope as 'global' | 'project') ?? 'global',
          themeId: body.themeId ?? undefined,
          tags: body.tags ?? [],
          source: 'user',
          confidence: 0.8,
        });
        return { success: true, id };
      } catch (err) {
        log.error({ err }, 'Failed to submit idea');
        set.status = 500;
        return { error: 'アイデアの登録に失敗しました' };
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        content: t.String({ minLength: 1 }),
        category: t.Optional(t.String()),
        scope: t.Optional(t.String()),
        themeId: t.Optional(t.Number()),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )

  /** Get idea statistics by category. */
  .get(
    '/idea-box/stats',
    async ({ query }) => {
      const categoryId = query.categoryId ? parseInt(query.categoryId) : undefined;
      return getIdeaStats(categoryId);
    },
    {
      query: t.Object({
        categoryId: t.Optional(t.String()),
      }),
    },
  )

  /** Manually trigger an innovation session. */
  .post('/idea-box/innovate', async () => {
    try {
      const count = await runInnovationSession();
      return { success: true, ideasGenerated: count };
    } catch (err) {
      log.error({ err }, 'Innovation session failed');
      return { success: false, error: 'イノベーションセッションに失敗しました' };
    }
  })

  /** Update an existing idea. Only provided fields are changed. */
  .patch(
    '/idea-box/:id',
    async ({ params, body, set }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) {
        set.status = 400;
        return { error: 'Invalid ID' };
      }

      try {
        const ok = await updateIdea(id, {
          title: body.title,
          content: body.content,
          category: body.category,
          scope: body.scope as 'global' | 'project' | undefined,
          // null clears themeId, undefined leaves it as-is
          themeId:
            body.themeId === undefined ? undefined : body.themeId === null ? null : body.themeId,
          tags: body.tags,
        });

        if (!ok) {
          set.status = 404;
          return { error: 'アイデアが見つかりません' };
        }
        return { success: true };
      } catch (err) {
        log.error({ err, id }, 'Failed to update idea');
        set.status = 400;
        return { error: err instanceof Error ? err.message : 'アイデアの更新に失敗しました' };
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        content: t.Optional(t.String()),
        category: t.Optional(t.String()),
        scope: t.Optional(t.String()),
        themeId: t.Optional(t.Union([t.Number(), t.Null()])),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )

  /** Delete an idea by ID. */
  .delete('/idea-box/:id', async ({ params, set }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    try {
      const success = await deleteIdea(id);
      if (!success) {
        set.status = 404;
        return { error: 'アイデアが見つかりません' };
      }
      return { success: true };
    } catch (err) {
      log.error({ err, id }, 'Failed to delete idea');
      set.status = 500;
      return { error: 'アイデアの削除に失敗しました' };
    }
  })

  /** Convert an idea to a task using AI. */
  .post(
    '/idea-box/:id/convert-to-task',
    async ({ params, body, set }) => {
      const ideaId = parseInt(params.id);
      if (isNaN(ideaId)) {
        set.status = 400;
        return { error: 'Invalid idea ID' };
      }

      try {
        // Get the idea
        const idea = await prisma.knowledgeEntry.findFirst({
          where: { id: ideaId, sourceType: 'idea_box' },
          select: {
            id: true,
            title: true,
            content: true,
            category: true,
            themeId: true,
          },
        });

        if (!idea) {
          set.status = 404;
          return { error: 'アイデアが見つかりません' };
        }

        // Check if already used
        const existingUsage = await prisma.knowledgeEntry.findFirst({
          where: { id: ideaId, sourceId: { startsWith: 'used_task_' } },
        });

        if (existingUsage) {
          set.status = 400;
          return { error: 'このアイデアは既にタスク化されています' };
        }

        // AI conversion prompt
        const prompt = `以下のアイデアを具体的なタスクに変換してください：

タイトル: ${idea.title}
内容: ${idea.content}
カテゴリ: ${idea.category}

以下のJSON形式で回答してください：
{
  "title": "タスクのタイトル",
  "description": "具体的な作業内容の説明",
  "priority": "high|medium|low",
  "estimatedHours": 数値,
  "status": "todo"
}`;

        // Call AI service (basic implementation)
        const aiResponse = await fetch(
          `${process.env.API_BASE_URL || 'http://localhost:3001'}/ai/chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              systemPrompt:
                'あなたはタスク管理のエキスパートです。アイデアを実行可能な具体的タスクに変換してください。',
            }),
          },
        );

        let taskData;
        if (aiResponse.ok) {
          const aiResult = (await aiResponse.json()) as { message?: string };
          try {
            taskData = JSON.parse(aiResult.message ?? '{}');
          } catch {
            // AI response parsing failed, use fallback
            taskData = {
              title: idea.title,
              description: idea.content,
              priority: 'medium',
              estimatedHours: 1,
              status: 'todo',
            };
          }
        } else {
          // AI service failed, use fallback
          taskData = {
            title: idea.title,
            description: idea.content,
            priority: 'medium',
            estimatedHours: 1,
            status: 'todo',
          };
        }

        // Create the task
        const newTask = await createTask(prisma, {
          title: taskData.title,
          description: taskData.description,
          priority: taskData.priority || 'medium',
          estimatedHours: taskData.estimatedHours || 1,
          status: taskData.status || 'todo',
          themeId: body.themeId ?? idea.themeId ?? undefined,
        });

        if (!newTask) {
          set.status = 500;
          return { error: 'タスクの作成に失敗しました' };
        }

        // Mark idea as used
        await markIdeaAsUsed(ideaId, newTask.id);

        log.info({ ideaId, taskId: newTask.id }, 'Idea converted to task');

        return {
          success: true,
          taskId: newTask.id,
          task: taskData,
        };
      } catch (err) {
        log.error({ err, ideaId }, 'Failed to convert idea to task');
        set.status = 500;
        return { error: 'アイデアのタスク変換に失敗しました' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        themeId: t.Optional(t.Number()),
        customInstructions: t.Optional(t.String()),
      }),
    },
  );
