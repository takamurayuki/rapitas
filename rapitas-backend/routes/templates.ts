/**
 * Templates API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { toJsonString, fromJsonString } from "../utils/db-helpers";

export const templatesRoutes = new Elysia({ prefix: "/templates" })
  .get("/", async (context: any) => {
      const { query  } = context;
    const { category, search, themeId  } = query as any;

    const where: Record<string, unknown> = {};

    if (category) {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    if (themeId) {
      where.themeId = parseInt(themeId);
    }

    return await prisma.taskTemplate.findMany({
      where,
      include: {
        theme: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
          },
        },
      },
      orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
    });
  })

  // カテゴリ一覧を取得
  .get("/categories", async () => {
    const templates = await prisma.taskTemplate.findMany({
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    return templates.map((t: { category: string }) => t.category);
  })

  .get("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    return await prisma.taskTemplate.findUnique({
      where: { id },
      include: {
        theme: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
          },
        },
      },
    });
  })

  .post(
    "/",
    async ({ 

      body,
    }: {
      body: {
        name: string;
        description?: string;
        category: string;
        templateData: unknown;
        themeId?: number;
      };
    }) => {
      const { name, description, category, templateData, themeId  } = body as any;
      return await prisma.taskTemplate.create({
        data: {
          name,
          category,
          templateData,
          ...(description && { description }),
          ...(themeId && { themeId }),
        },
        include: {
          theme: {
            select: {
              id: true,
              name: true,
              color: true,
              icon: true,
            },
          },
        },
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        category: t.String(),
        templateData: t.Any(),
        themeId: t.Optional(t.Number()),
      }),
    }
  )

  // タスクからテンプレートを作成
  .post(
    "/from-task/:taskId",
    async ({ 

      params,
      body,
    }: {
      params: { taskId: string };
      body: { name: string; description?: string; category: string };
    }) => {
      const taskId = parseInt(params.taskId);
      const { name, description, category  } = body as any;

      // タスクを取得（サブタスク含む）
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          subtasks: {
            select: {
              title: true,
              description: true,
              estimatedHours: true,
            },
            orderBy: { id: "asc" },
          },
          taskLabels: {
            include: {
              label: {
                select: { name: true },
              },
            },
          },
        },
      });

      if (!task) {
        return { error: "Task not found" };
      }

      // テンプレートデータを構築
      const templateData = {
        title: task.title,
        description: task.description,
        priority: task.priority,
        estimatedHours: task.estimatedHours,
        labels:
          task.taskLabels
            ?.map((tl: { label: { name: string } }) => tl.label?.name)
            .filter(Boolean) || [],
        subtasks: task.subtasks.map(
          (st: {
            title: string;
            description?: string | null;
            estimatedHours?: number | null;
          }) => ({
            title: st.title,
            description: st.description,
            estimatedHours: st.estimatedHours,
          })
        ),
      };

      // テンプレートを作成（タスクのテーマも保存）
      const template = await prisma.taskTemplate.create({
        data: {
          name,
          category,
          templateData: toJsonString(templateData) ?? "{}",
          ...(description && { description }),
          ...(task.themeId && { themeId: task.themeId }),
        },
        include: {
          theme: {
            select: {
              id: true,
              name: true,
              color: true,
              icon: true,
            },
          },
        },
      });

      return template;
    }
  )

  .delete("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    return await prisma.taskTemplate.delete({ where: { id } });
  })

  // テンプレートからタスク作成
  .post(
    "/:id/apply",
    async ({ 

      params,
      body,
    }: {
      params: { id: string };
      body?: {
        themeId?: number;
        projectId?: number;
        milestoneId?: number;
        title?: string;
        dueDate?: string;
      };
    }) => {
      const id = parseInt(params.id);
      const { themeId, projectId, milestoneId, title: customTitle, dueDate } = body || {};

      const template = await prisma.taskTemplate.findUnique({
        where: { id },
      });
      if (!template) return { error: "Template not found" };

      const data = fromJsonString<{
        title?: string;
        description?: string;
        priority?: string;
        estimatedHours?: number;
        subject?: string;
        subtasks?: { title: string; description?: string; estimatedHours?: number }[];
        labels?: string[];
      }>(template.templateData);

      const task = await prisma.task.create({
        data: {
          title: customTitle || data?.title || template.name,
          description: data?.description,
          priority: data?.priority || "medium",
          estimatedHours: data?.estimatedHours,
          subject: data?.subject,
          ...(themeId && { themeId }),
          ...(projectId && { projectId }),
          ...(milestoneId && { milestoneId }),
          ...(dueDate && { dueDate: new Date(dueDate) }),
        },
      });

      // サブタスクも作成（説明とestimatedHoursを含む）
      if (data?.subtasks && Array.isArray(data.subtasks)) {
        for (const st of data.subtasks) {
          await prisma.task.create({
            data: {
              title: st.title,
              description: st.description,
              estimatedHours: st.estimatedHours,
              parentId: task.id,
              status: "todo",
            },
          });
        }
      }

      // ラベルを取得して紐付け（テンプレートに保存されたラベル名から）
      if (data?.labels && Array.isArray(data.labels) && data.labels.length > 0) {
        const labels = await prisma.label.findMany({
          where: {
            name: { in: data.labels },
          },
        });

        if (labels.length > 0) {
          await prisma.taskLabel.createMany({
            data: labels.map((label: { id: number }) => ({
              taskId: task.id,
              labelId: label.id,
            })),
          });
        }
      }

      // 使用回数を増やす
      await prisma.taskTemplate.update({
        where: { id },
        data: { useCount: { increment: 1 } },
      });

      // 作成したタスクをリレーション付きで返す
      const createdTask = await prisma.task.findUnique({
        where: { id: task.id },
        include: {
          subtasks: true,
          taskLabels: {
            include: { label: true },
          },
          theme: true,
          project: true,
          milestone: true,
        },
      });

      return createdTask;
    }
  );
