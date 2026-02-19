/**
 * Themes API Routes
 * Handles theme CRUD operations and default theme management
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { themeSchema } from "../schemas/theme.schema";
import { NotFoundError, ValidationError } from "../middleware/error-handler";

export const themesRoutes = new Elysia({ prefix: "/themes" })
  // Get all themes
  .get("/", async () => {
    return await prisma.theme.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
        category: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  })

  // Get default theme (must be before /:id to avoid route conflict)
  .get("/default/get", async () => {
    return await prisma.theme.findFirst({
      where: { isDefault: true },
      include: { category: true },
    });
  })

  // Get theme by ID
  .get(
    "/:id",
    async ({  params  }: any) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    // Get the theme to find its category
    const theme = await prisma.theme.findUnique({
      where: { id },
    });

    if (!theme) {
      throw new NotFoundError("テーマが見つかりません");
    }

    // Reset isDefault for themes in the same category only
    if (theme.categoryId) {
      await prisma.theme.updateMany({
        where: { categoryId: theme.categoryId, isDefault: true },
        data: { isDefault: false },
      });
    } else {
      // If no category, reset all themes without a category
      await prisma.theme.updateMany({
        where: { categoryId: null, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Set the specified theme as default
    return await prisma.theme.update({
      where: { id },
      data: { isDefault: true },
      include: { category: true },
    });
  });
