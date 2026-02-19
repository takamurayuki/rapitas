/**
 * Milestones API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { milestoneSchema } from "../schemas/milestone.schema";
import { ValidationError } from "../middleware/error-handler";

export const milestonesRoutes = new Elysia({ prefix: "/milestones" })
  // Get all milestones
  .get("/", async ({  query  }: any) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.milestone.delete({
      where: { id },
    });
  });
