/**
 * Directory Browser & Favorites API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import * as fs from "fs";
import * as path from "path";

export const directoriesRoutes = new Elysia({ prefix: "/directories" })
  // Browse directories
  .get("/browse", async (context: any) => {
      const { query  } = context;
    const { path: dirPath  } = query as any;

    try {
      if (!dirPath || dirPath.trim() === "") {
        if (process.platform === "win32") {
          const { execSync } = require("child_process");
          try {
            const result = execSync("wmic logicaldisk get name", {
              encoding: "utf8",
            });
            const drives = result
              .split("\n")
              .filter((line: string) => /^[A-Z]:/.test(line.trim()))
              .map((line: string) => line.trim());

            return {
              path: "",
              parent: null,
              directories: drives.map((drive: string) => ({
                name: `${drive} ドライブ`,
                path: drive + "\\",
                isDirectory: true,
              })),
              isDriveList: true,
            };
          } catch (e) {
            return {
              path: "",
              parent: null,
              directories: [
                { name: "C: ドライブ", path: "C:\\", isDirectory: true },
                { name: "D: ドライブ", path: "D:\\", isDirectory: true },
              ],
              isDriveList: true,
            };
          }
        } else {
          return {
            path: "/",
            parent: null,
            directories: fs
              .readdirSync("/", { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .filter((entry) => !entry.name.startsWith("."))
              .map((entry) => ({
                name: entry.name,
                path: "/" + entry.name,
                isDirectory: true,
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }
      }

      let targetPath = dirPath.trim();

      if (process.platform === "win32" && /^[A-Z]:$/i.test(targetPath)) {
        targetPath = targetPath + "\\";
      }

      const normalizedPath = path.resolve(targetPath);

      if (!fs.existsSync(normalizedPath)) {
        return {
          error: `パスが存在しません: ${normalizedPath}`,
          path: normalizedPath,
        };
      }

      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { error: "ディレクトリではありません", path: normalizedPath };
      }

      let entries;
      try {
        entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
      } catch (e) {
        return {
          error: `アクセスできません: ${e instanceof Error ? e.message : String(e)}`,
          path: normalizedPath,
        };
      }

      const directories = entries
        .filter((entry) => {
          try {
            return entry.isDirectory();
          } catch {
            return false;
          }
        })
        .filter((entry) => !entry.name.startsWith("."))
        .filter((entry) => {
          const excludeNames = [
            "$Recycle.Bin",
            "$RECYCLE.BIN",
            "System Volume Information",
            "Recovery",
          ];
          return !excludeNames.includes(entry.name);
        })
        .map((entry) => ({
          name: entry.name,
          path: path.join(normalizedPath, entry.name),
          isDirectory: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parentPath = path.dirname(normalizedPath);
      const isDriveRoot =
        process.platform === "win32" && /^[A-Z]:\\?$/i.test(normalizedPath);
      const hasParent = parentPath !== normalizedPath && !isDriveRoot;

      return {
        path: normalizedPath,
        parent: hasParent ? parentPath : null,
        directories,
        isGitRepo: fs.existsSync(path.join(normalizedPath, ".git")),
        isDriveList: false,
      };
    } catch (error) {
      return { error: (error instanceof Error ? error.message : String(error)) || "ディレクトリの取得に失敗しました" };
    }
  })

  // Validate path
  .post(
    "/validate",
    async (context: any) => {
      const { body  } = context;
      const { path: dirPath  } = body as any;

      if (!dirPath) {
        return { valid: false, error: "パスが指定されていません" };
      }

      try {
        const normalizedPath = path.resolve(dirPath);

        if (!fs.existsSync(normalizedPath)) {
          return { valid: false, error: "パスが存在しません" };
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isDirectory()) {
          return { valid: false, error: "ディレクトリではありません" };
        }

        return {
          valid: true,
          path: normalizedPath,
          isGitRepo: fs.existsSync(path.join(normalizedPath, ".git")),
        };
      } catch (error) {
        return { valid: false, error: (error instanceof Error ? error.message : String(error)) || "検証に失敗しました" };
      }
    },
    {
      body: t.Object({
        path: t.String(),
      }),
    },
  )

  // Get favorite directories
  .get("/favorites", async () => {
    try {
      const favorites = await prisma.favoriteDirectory.findMany({
        orderBy: { createdAt: "desc" },
      });
      return favorites.map((fav: { path: string }) => ({
        ...fav,
        exists: fs.existsSync(fav.path),
        isGitRepo: fs.existsSync(path.join(fav.path, ".git")),
      }));
    } catch (error) {
      return { error: (error instanceof Error ? error.message : String(error)) || "お気に入りの取得に失敗しました" };
    }
  })

  // Add favorite directory
  .post(
    "/favorites",
    async (context: any) => {
      const { body  } = context;
      const { path: dirPath, name  } = body as any;

      try {
        const normalizedPath = path.resolve(dirPath);
        const dirName = name || path.basename(normalizedPath);

        const existing = await prisma.favoriteDirectory.findFirst({
          where: { path: normalizedPath },
        });

        if (existing) {
          return {
            error: "このパスは既にお気に入りに登録されています",
            existing,
          };
        }

        const favorite = await prisma.favoriteDirectory.create({
          data: {
            path: normalizedPath,
            name: dirName,
          },
        });

        return {
          ...favorite,
          exists: fs.existsSync(normalizedPath),
          isGitRepo: fs.existsSync(path.join(normalizedPath, ".git")),
        };
      } catch (error) {
        return { error: (error instanceof Error ? error.message : String(error)) || "お気に入りの追加に失敗しました" };
      }
    },
    {
      body: t.Object({
        path: t.String(),
        name: t.Optional(t.String()),
      }),
    },
  )

  // Update favorite directory
  .patch(
    "/favorites/:id",
    async ({ 

      params,
      body,
    }: {
      params: { id: string };
      body: { name?: string };
    }) => {
      const id = parseInt(params.id);
      const { name  } = body as any;

      try {
        const favorite = await prisma.favoriteDirectory.update({
          where: { id },
          data: { ...(name && { name }) },
        });

        return {
          ...favorite,
          exists: fs.existsSync(favorite.path),
          isGitRepo: fs.existsSync(path.join(favorite.path, ".git")),
        };
      } catch (error) {
        return { error: (error instanceof Error ? error.message : String(error)) || "お気に入りの更新に失敗しました" };
      }
    },
  )

  // Create a new directory
  .post(
    "/create",
    async (context: any) => {
      const { body  } = context;
      const { path: dirPath  } = body as any;

      if (!dirPath || !dirPath.trim()) {
        return { success: false, error: "パスが指定されていません" };
      }

      try {
        const normalizedPath = path.resolve(dirPath.trim());

        if (fs.existsSync(normalizedPath)) {
          return {
            success: false,
            error: "このフォルダは既に存在します",
            path: normalizedPath,
          };
        }

        // Check parent directory exists
        const parentDir = path.dirname(normalizedPath);
        if (!fs.existsSync(parentDir)) {
          return {
            success: false,
            error: "親ディレクトリが存在しません",
            path: normalizedPath,
          };
        }

        fs.mkdirSync(normalizedPath, { recursive: true });

        return {
          success: true,
          path: normalizedPath,
          isGitRepo: false,
        };
      } catch (error) {
        return {
          success: false,
          error: (error instanceof Error ? error.message : String(error)) || "フォルダの作成に失敗しました",
        };
      }
    },
    {
      body: t.Object({
        path: t.String(),
      }),
    },
  )

  // Delete favorite directory
  .delete("/favorites/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);

    try {
      await prisma.favoriteDirectory.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      return { error: (error instanceof Error ? error.message : String(error)) || "お気に入りの削除に失敗しました" };
    }
  });
