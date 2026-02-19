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
    async ({  params  }: any) => {
      try {
        const { workingDirectory } = body as any;
        if (!workingDirectory) {
          return { error: "workingDirectory is required" };
        }

        const projectInfo = detectProjectInfo(workingDirectory);
        return {
          success: true,
          project: projectInfo,
        };
      } catch (error) {
        return {
          success: false,
          error: (error instanceof Error ? error.message : String(error)),
        };
      }
    },
  );
