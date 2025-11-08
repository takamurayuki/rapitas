import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";

const app = new Elysia();
const prisma = new PrismaClient();

app.use(cors());

app.get("/tasks", async () => {
  return await prisma.task.findMany({
    // @ts-ignore - Prisma Client type not updated
    where: { parentId: null },
    // @ts-ignore - Prisma Client type not updated
    include: {
      subtasks: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/tasks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.task.findUnique({
    where: { id: parseInt(id) },
    // @ts-ignore - Prisma Client type not updated
    include: {
      subtasks: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
});

app.post("/tasks", async ({ body }) => {
  const { title, description, status, labels, estimatedHours, parentId } =
    body as {
      title: string;
      description?: string;
      status?: string;
      labels?: string[];
      estimatedHours?: number;
      parentId?: number;
    };
  return await prisma.task.create({
    data: {
      title,
      ...(description && { description }),
      status: status ?? "todo",
      ...(labels && { labels }),
      ...(estimatedHours && { estimatedHours }),
      ...(parentId && { parentId }),
    },
    // @ts-ignore - Prisma Client type not updated
    include: {
      subtasks: true,
    },
  });
});

app.patch("/tasks/:id", async ({ params, body }) => {
  const { id } = params;
  const { title, description, status, labels, estimatedHours } = body as {
    title?: string;
    description?: string;
    status?: string;
    labels?: string[];
    estimatedHours?: number;
  };
  return await prisma.task.update({
    where: { id: parseInt(id) },
    data: {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      ...(labels && { labels }),
      ...(estimatedHours !== undefined && { estimatedHours }),
    },
  });
});

app.delete("/tasks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.task.delete({
    where: { id: parseInt(id) },
  });
});

app.listen(3001);
console.log("🚀 Rapitas backend running on http://localhost:3001");
