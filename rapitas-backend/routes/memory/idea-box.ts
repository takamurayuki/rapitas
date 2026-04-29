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
import { sendAIMessage, type AIProvider } from '../../utils/ai-client';

const log = createLogger('routes:idea-box');
const AI_PROVIDERS: AIProvider[] = ['claude', 'chatgpt', 'gemini', 'ollama'];

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
        const idea = await prisma.knowledgeEntry.findFirst({
          where: { id: ideaId, sourceType: 'idea_box' },
          select: {
            id: true,
            title: true,
            content: true,
            category: true,
            themeId: true,
            sourceId: true,
          },
        });

        if (!idea) {
          set.status = 404;
          return { error: 'アイデアが見つかりません' };
        }

        if (idea.sourceId?.startsWith('used_task_')) {
          set.status = 400;
          return { error: 'このアイデアは既にタスク化されています' };
        }

        const targetThemeId = body.themeId ?? idea.themeId ?? undefined;
        const targetTheme = targetThemeId
          ? await prisma.theme.findUnique({
              where: { id: targetThemeId },
              select: { id: true, name: true, category: { select: { id: true, name: true } } },
            })
          : null;

        if (targetThemeId && !targetTheme) {
          set.status = 400;
          return { error: '指定されたテーマが見つかりません' };
        }

        const prompt = `以下のアイデアを具体的なタスクに変換してください：

タイトル: ${idea.title}
内容: ${idea.content}
アイデア分類: ${idea.category}
登録先カテゴリ: ${targetTheme?.category?.name ?? '未指定'}
登録先テーマ: ${targetTheme?.name ?? '未指定'}
追加指示: ${body.customInstructions?.trim() || 'なし'}

以下のJSON形式で回答してください：
{
  "title": "タスクのタイトル",
  "description": "具体的な作業内容の説明",
  "priority": "urgent|high|medium|low",
  "estimatedHours": 数値,
  "status": "todo"
}`;

        let taskData = {
          title: idea.title,
          description: idea.content,
          priority: 'medium',
          estimatedHours: 1,
          status: 'todo',
        };

        try {
          const provider = AI_PROVIDERS.includes(body.provider as AIProvider)
            ? (body.provider as AIProvider)
            : 'ollama';
          const response = await sendAIMessage({
            provider,
            messages: [{ role: 'user', content: prompt }],
            systemPrompt:
              'あなたはタスク管理のエキスパートです。アイデアを実行可能で具体的なタスクに変換してください。回答はJSONのみで返してください。',
            maxTokens: 1000,
            skipCache: true,
            ...(targetThemeId ? { ragThemeId: targetThemeId } : {}),
          });
          const jsonText = response.content.match(/\{[\s\S]*\}/)?.[0] ?? response.content;
          const parsed = JSON.parse(jsonText) as Partial<typeof taskData>;
          taskData = {
            title: parsed.title?.trim() || taskData.title,
            description: parsed.description?.trim() || taskData.description,
            priority: ['urgent', 'high', 'medium', 'low'].includes(parsed.priority ?? '')
              ? parsed.priority!
              : 'medium',
            estimatedHours:
              typeof parsed.estimatedHours === 'number' && parsed.estimatedHours > 0
                ? parsed.estimatedHours
                : 1,
            status: parsed.status === 'todo' ? 'todo' : 'todo',
          };
        } catch (aiErr) {
          log.warn({ err: aiErr, ideaId }, 'AI conversion failed, using fallback task data');
        }

        const newTask = await createTask(prisma, {
          title: taskData.title,
          description: taskData.description,
          priority: taskData.priority || 'medium',
          estimatedHours: taskData.estimatedHours || 1,
          status: taskData.status || 'todo',
          themeId: targetThemeId,
          isAiTaskAnalysis: true,
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
          task: newTask,
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
        provider: t.Optional(t.String()),
      }),
    },
  );
