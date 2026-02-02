/**
 * Tasks API Routes
 * Core task CRUD operations
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";

export const tasksRoutes = new Elysia({ prefix: "/tasks" })
  // Get all tasks
  .get(
    "/",
    async ({ query }: {
      query: { projectId?: string; milestoneId?: string; priority?: string }
    }) => {
      const { projectId, milestoneId, priority } = query;

      return await prisma.task.findMany({
        where: {
          parentId: null,
          ...(projectId && { projectId: parseInt(projectId) }),
          ...(milestoneId && { milestoneId: parseInt(milestoneId) }),
          ...(priority && { priority }),
        },
        include: {
          subtasks: {
            orderBy: { createdAt: "asc" },
          },
          theme: true,
          project: true,
          milestone: true,
          examGoal: true,
          taskLabels: {
            include: {
              label: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }
  )

  // Get task by ID
  .get("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.task.findUnique({
      where: { id },
      // @ts-ignore
      include: {
        subtasks: {
          orderBy: { createdAt: "asc" },
        },
        theme: true,
        project: true,
        milestone: true,
        examGoal: true,
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
    });
  })

  // Create task
  .post(
    "/",
    async ({ body }: { body: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      labels?: string[];
      labelIds?: number[];
      estimatedHours?: number;
      dueDate?: string;
      subject?: string;
      parentId?: number;
      projectId?: number;
      milestoneId?: number;
      themeId?: number;
      examGoalId?: number;
      isDeveloperMode?: boolean;
      isAiTaskAnalysis?: boolean;
    }}) => {
      const {
        title,
        description,
        status,
        priority,
        labels,
        labelIds,
        estimatedHours,
        dueDate,
        subject,
        parentId,
        projectId,
        milestoneId,
        themeId,
        examGoalId,
        isDeveloperMode,
        isAiTaskAnalysis,
      } = body;

      const task = await prisma.task.create({
        data: {
          title,
          ...(description && { description }),
          status: status ?? "todo",
          // @ts-ignore
          priority: priority ?? "medium",
          ...(labels && { labels }),
          ...(estimatedHours && { estimatedHours }),
          ...(dueDate && { dueDate: new Date(dueDate) }),
          ...(subject && { subject }),
          ...(parentId && { parentId }),
          ...(projectId && { projectId }),
          ...(milestoneId && { milestoneId }),
          ...(themeId !== undefined && { themeId }),
          ...(examGoalId !== undefined && { examGoalId }),
          ...(isDeveloperMode !== undefined && { isDeveloperMode }),
          ...(isAiTaskAnalysis !== undefined && { isAiTaskAnalysis }),
        },
      });

      // Label associations
      if (labelIds && labelIds.length > 0) {
        await prisma.taskLabel.createMany({
          data: labelIds.map((labelId: number) => ({
            taskId: task.id,
            labelId,
          })),
        });
      }

      // @ts-ignore
      return await prisma.task.findUnique({
        where: { id: task.id },
        include: {
          subtasks: true,
          theme: true,
          project: true,
          milestone: true,
          examGoal: true,
          taskLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        status: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        labels: t.Optional(t.Array(t.String())),
        labelIds: t.Optional(t.Array(t.Number())),
        estimatedHours: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        parentId: t.Optional(t.Number()),
        projectId: t.Optional(t.Number()),
        milestoneId: t.Optional(t.Number()),
        themeId: t.Optional(t.Number()),
        examGoalId: t.Optional(t.Number()),
        isDeveloperMode: t.Optional(t.Boolean()),
        isAiTaskAnalysis: t.Optional(t.Boolean()),
      }),
    }
  )

  // Update task
  .patch(
    "/:id",
    async ({ params, body }: {
      params: { id: string };
      body: {
        title?: string;
        description?: string;
        themeId?: number | null;
        status?: string;
        priority?: string;
        labels?: string[];
        labelIds?: number[];
        estimatedHours?: number;
        dueDate?: string | null;
        subject?: string | null;
        projectId?: number | null;
        milestoneId?: number | null;
        examGoalId?: number | null;
      }
    }) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なIDです");
      }

      const {
        title,
        description,
        themeId,
        status,
        priority,
        labels,
        labelIds,
        estimatedHours,
        dueDate,
        subject,
        projectId,
        milestoneId,
        examGoalId,
      } = body;

      // Record streak on task completion
      if (status === "done") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await prisma.studyStreak.upsert({
          where: { date: today },
          update: { tasksCompleted: { increment: 1 } },
          create: { date: today, studyMinutes: 0, tasksCompleted: 1 },
        });
      }

      await prisma.task.update({
        where: { id: taskId },
        data: {
          ...(title && { title }),
          ...(description !== undefined && { description }),
          ...(themeId !== undefined && { themeId }),
          ...(status && { status }),
          ...(status === "done" && { completedAt: new Date() }),
          // @ts-ignore
          ...(priority && { priority }),
          ...(labels && { labels }),
          ...(estimatedHours !== undefined && { estimatedHours }),
          ...(dueDate !== undefined && {
            dueDate: dueDate ? new Date(dueDate) : null,
          }),
          ...(subject !== undefined && { subject }),
          ...(projectId !== undefined && { projectId }),
          ...(milestoneId !== undefined && { milestoneId }),
          ...(examGoalId !== undefined && { examGoalId }),
        },
      });

      // Update labels if provided
      if (labelIds !== undefined) {
        await prisma.taskLabel.deleteMany({
          where: { taskId },
        });
        if (labelIds.length > 0) {
          await prisma.taskLabel.createMany({
            data: labelIds.map((labelId) => ({
              taskId,
              labelId,
            })),
          });
        }
      }

      // @ts-ignore
      return await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          theme: true,
          project: true,
          milestone: true,
          examGoal: true,
          taskLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    }
  )

  // Delete task
  .delete("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.task.delete({
      where: { id },
    });
  });
