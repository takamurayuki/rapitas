/**
 * Screenshots API Routes
 * スクリーンショットの配信と撮影（汎用プロジェクト対応）
 */
import { Elysia } from "elysia";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import {
  captureScreenshots,
  detectProjectInfo,
  type ScreenshotOptions,
} from "../services/screenshot-service";

const SCREENSHOT_DIR = join(process.cwd(), "uploads", "screenshots");

export const screenshotsRoutes = new Elysia()
  // スクリーンショット画像の配信
  .get(
    "/screenshots/:filename",
    async ({ params, set }: { params: { filename: string }; set: any }) => {
      const { filename } = params;

      // パストラバーサル防止
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        set.status = 400;
        return { error: "Invalid filename" };
      }

      const filePath = join(SCREENSHOT_DIR, filename);

      if (!existsSync(filePath)) {
        set.status = 404;
        return { error: "Screenshot not found" };
      }

      set.headers["Content-Type"] = "image/png";
      set.headers["Cache-Control"] = "public, max-age=86400";
      return new Response(readFileSync(filePath));
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
