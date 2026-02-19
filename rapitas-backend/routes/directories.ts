/**
 * Directory Browser & Favorites API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import * as fs from "fs";
import * as path from "path";

export const directoriesRoutes = new Elysia({ prefix: "/directories" })
  // Browse directories
  .get("/browse", async ({  query  }: any) => {
    const id = parseInt(params.id);

    try {
      await prisma.favoriteDirectory.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      return { error: (error instanceof Error ? error.message : String(error)) || "お気に入りの削除に失敗しました" };
    }
  });
