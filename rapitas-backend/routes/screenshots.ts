/**
 * Screenshots API Routes
 * スクリーンショットの配信と撮影（汎用プロジェクト対応）
 */
import { Elysia } from "elysia";
import { join } from "path";
import { existsSync } from "fs";
import {
  captureScreenshots,
  captureAllScreenshots,
  detectProjectInfo,
  detectAllPages,
  type ScreenshotOptions,
} from "../services/screenshot-service";

const SCREENSHOT_DIR = join(process.cwd(), "uploads", "screenshots");

export const screenshotsRoutes = new Elysia()
  // スクリーンショット画像の配信
  .get(
    "/screenshots/:filename",
    async ({ params }: { params: { filename: string } }) => {
      const { filename } = params;

      // パストラバーサル防止
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return new Response(JSON.stringify({ error: "Invalid filename" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const filePath = join(SCREENSHOT_DIR, filename);

      if (!existsSync(filePath)) {
        return new Response(JSON.stringify({ error: "Screenshot not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Bun.file() を使用して効率的にファイルを配信
      return new Response(Bun.file(filePath), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
  )

  // 手動でスクリーンショットを撮影
  .post(
    "/screenshots/capture",
    async ({ body }: { body: ScreenshotOptions }) => {
      try {
        const results = await captureScreenshots(body);
        return {
          success: true,
          screenshots: results,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          screenshots: [],
        };
      }
    },
  )

  // 全ページのスクリーンショットを撮影（changedFiles 指定時は変更ページのみ）
  .post(
    "/screenshots/capture-all",
    async ({ body }: { body: ScreenshotOptions & { changedFiles?: string[] } }) => {
      try {
        if (!body.workingDirectory) {
          return {
            success: false,
            error: "workingDirectory is required",
            screenshots: [],
          };
        }
        const results = await captureAllScreenshots(body);
        return {
          success: true,
          screenshots: results,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          screenshots: [],
        };
      }
    },
  )

  // プロジェクトの全ページルートを検出
  .post(
    "/screenshots/detect-pages",
    async ({ body }: { body: { workingDirectory: string } }) => {
      try {
        const { workingDirectory } = body;
        if (!workingDirectory) {
          return { success: false, error: "workingDirectory is required" };
        }

        const pages = detectAllPages(workingDirectory);
        const projectInfo = detectProjectInfo(workingDirectory);
        return {
          success: true,
          project: projectInfo,
          pages,
          totalPages: pages.length,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  )

  // プロジェクト構造を検出
  .post(
    "/screenshots/detect-project",
    async ({ body }: { body: { workingDirectory: string } }) => {
      try {
        const { workingDirectory } = body;
        if (!workingDirectory) {
          return { error: "workingDirectory is required" };
        }

        const projectInfo = detectProjectInfo(workingDirectory);
        return {
          success: true,
          project: projectInfo,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );
