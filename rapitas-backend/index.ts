import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";

const app = new Elysia();
const prisma = new PrismaClient();

app.use(cors());

// ==================== Themes API ====================
app.get("/themes", async () => {
  return await prisma.theme.findMany({
    include: {
      _count: {
        select: { tasks: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/themes/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.theme.findUnique({
    where: { id: parseInt(id) },
    include: {
      tasks: {
        where: { parentId: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post("/themes", async ({ body }) => {
  const { name, description, color, icon } = body as {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.theme.create({
    data: {
      name,
      ...(description && { description }),
      ...(color && { color }),
      ...(icon && { icon }),
    },
  });
});

app.patch("/themes/:id", async ({ params, body }) => {
  const { id } = params;
  const { name, description, color, icon } = body as {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.theme.update({
    where: { id: parseInt(id) },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(color && { color }),
      ...(icon !== undefined && { icon }),
    },
  });
});

app.delete("/themes/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.theme.delete({
    where: { id: parseInt(id) },
  });
});

// デフォルトテーマ設定
app.patch("/themes/:id/set-default", async ({ params }) => {
  const { id } = params;
  const themeId = parseInt(id);

  // まず全てのテーマのisDefaultをfalseにする
  await prisma.theme.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });

  // 指定されたテーマをデフォルトにする
  return await prisma.theme.update({
    where: { id: themeId },
    data: { isDefault: true },
  });
});

// デフォルトテーマ取得
app.get("/themes/default/get", async () => {
  return await prisma.theme.findFirst({
    where: { isDefault: true },
  });
});

// ==================== Projects API ====================
app.get("/projects", async () => {
  return await prisma.project.findMany({
    include: {
      _count: {
        select: { tasks: true, milestones: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/projects/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.project.findUnique({
    where: { id: parseInt(id) },
    include: {
      milestones: {
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { tasks: true } },
        },
      },
      tasks: {
        where: { parentId: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post("/projects", async ({ body }) => {
  const { name, description, color, icon } = body as {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.project.create({
    data: {
      name,
      ...(description && { description }),
      ...(color && { color }),
      ...(icon && { icon }),
    },
  });
});

app.patch("/projects/:id", async ({ params, body }) => {
  const { id } = params;
  const { name, description, color, icon } = body as {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.project.update({
    where: { id: parseInt(id) },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(color && { color }),
      ...(icon !== undefined && { icon }),
    },
  });
});

app.delete("/projects/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.project.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Milestones API ====================
app.get("/milestones", async ({ query }) => {
  const { projectId } = query as { projectId?: string };
  return await prisma.milestone.findMany({
    where: projectId ? { projectId: parseInt(projectId) } : undefined,
    include: {
      project: true,
      _count: { select: { tasks: true } },
    },
    orderBy: { createdAt: "asc" },
  });
});

app.get("/milestones/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.milestone.findUnique({
    where: { id: parseInt(id) },
    include: {
      project: true,
      tasks: {
        where: { parentId: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post("/milestones", async ({ body }) => {
  const { name, description, dueDate, projectId } = body as {
    name: string;
    description?: string;
    dueDate?: string;
    projectId: number;
  };
  return await prisma.milestone.create({
    data: {
      name,
      projectId,
      ...(description && { description }),
      ...(dueDate && { dueDate: new Date(dueDate) }),
    },
    include: {
      project: true,
    },
  });
});

app.patch("/milestones/:id", async ({ params, body }) => {
  const { id } = params;
  const { name, description, dueDate } = body as {
    name?: string;
    description?: string;
    dueDate?: string;
  };
  return await prisma.milestone.update({
    where: { id: parseInt(id) },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(dueDate !== undefined && {
        dueDate: dueDate ? new Date(dueDate) : null,
      }),
    },
  });
});

app.delete("/milestones/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.milestone.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Tasks API ====================
app.get("/tasks", async ({ query }) => {
  const { projectId, milestoneId, priority } = query as {
    projectId?: string;
    milestoneId?: string;
    priority?: string;
  };

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
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/tasks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.task.findUnique({
    where: { id: parseInt(id) },
    // @ts-ignore
    include: {
      subtasks: {
        orderBy: { createdAt: "asc" },
      },
      project: true,
      milestone: true,
    },
  });
});

app.post("/tasks", async ({ body }) => {
  const {
    title,
    description,
    status,
    priority,
    labels,
    estimatedHours,
    parentId,
    projectId,
    milestoneId,
    themeId,
  } = body as {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    labels?: string[];
    estimatedHours?: number;
    parentId?: number;
    projectId?: number;
    milestoneId?: number;
    themeId?: number;
  };
  return await prisma.task.create({
    data: {
      title,
      ...(description && { description }),
      status: status ?? "todo",
      // @ts-ignore
      priority: priority ?? "medium",
      ...(labels && { labels }),
      ...(estimatedHours && { estimatedHours }),
      ...(parentId && { parentId }),
      ...(projectId && { projectId }),
      ...(milestoneId && { milestoneId }),
      ...(themeId !== undefined && { themeId }),
    },
    // @ts-ignore
    include: {
      subtasks: true,
      theme: true,
      project: true,
      milestone: true,
    },
  });
});

app.patch("/tasks/:id", async ({ params, body }) => {
  const { id } = params;
  const {
    title,
    description,
    themeId,
    status,
    priority,
    labels,
    estimatedHours,
    projectId,
    milestoneId,
  } = body as {
    title?: string;
    description?: string;
    themeId?: number | null;
    status?: string;
    priority?: string;
    labels?: string[];
    estimatedHours?: number;
    projectId?: number | null;
    milestoneId?: number | null;
  };
  return await prisma.task.update({
    where: { id: parseInt(id) },
    data: {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(themeId !== undefined && { themeId }),
      ...(status && { status }),
      // @ts-ignore
      ...(priority && { priority }),
      ...(labels && { labels }),
      ...(estimatedHours !== undefined && { estimatedHours }),
      ...(projectId !== undefined && { projectId }),
      ...(milestoneId !== undefined && { milestoneId }),
    },
    // @ts-ignore
    include: {
      theme: true,
      project: true,
      milestone: true,
    },
  });
});

app.delete("/tasks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.task.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Time Entries API ====================
app.get("/tasks/:id/time-entries", async ({ params }) => {
  const { id } = params;
  return await prisma.timeEntry.findMany({
    where: { taskId: parseInt(id) },
    orderBy: { startedAt: "desc" },
  });
});

app.post("/tasks/:id/time-entries", async ({ params, body }) => {
  const { id } = params;
  const { duration, note, startedAt, endedAt } = body as {
    duration: number;
    note?: string;
    startedAt: string;
    endedAt: string;
  };
  return await prisma.timeEntry.create({
    data: {
      taskId: parseInt(id),
      duration,
      note,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
    },
  });
});

// ==================== Comments API ====================
app.get("/tasks/:id/comments", async ({ params }) => {
  const { id } = params;
  return await prisma.comment.findMany({
    where: { taskId: parseInt(id) },
    orderBy: { createdAt: "desc" },
  });
});

app.post("/tasks/:id/comments", async ({ params, body }) => {
  const { id } = params;
  const { content } = body as { content: string };
  return await prisma.comment.create({
    data: {
      taskId: parseInt(id),
      content,
    },
  });
});

app.listen(3001);
console.log("🚀 Rapitas backend running on http://localhost:3001");
