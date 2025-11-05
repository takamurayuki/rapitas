import { Elysia } from "elysia";
import { PrismaClient } from "@prisma/client";

const app = new Elysia();
const prisma = new PrismaClient();

app.get("/tasks", async () => prisma.task.findMany());

app.post("/tasks", async ({ body }) => {
  const { title, status } = body as { title: string; status?: string };
  return await prisma.task.create({
    data: {
      title,
      status: status ?? "todo",
    },
  });
});

app.listen(3001);
console.log("🚀 Rapitas backend running on http://localhost:3001");
