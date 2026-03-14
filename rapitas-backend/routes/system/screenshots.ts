/**
 * Screenshots API Routes
 * Screenshot serving and capture (multi-project support)
 */
import { Elysia, t } from 'elysia';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  captureScreenshots,
  captureAllScreenshots,
  detectProjectInfo,
  detectAllPages,
  type ScreenshotOptions,
} from '../../services/screenshot-service';

const SCREENSHOT_DIR = join(process.cwd(), 'uploads', 'screenshots');

export const screenshotsRoutes = new Elysia()
  // Serve screenshot images
  .get('/screenshots/:filename', async (context) => {
    const { params } = context;
    const { filename } = params;

    // Path traversal prevention
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return new Response(JSON.stringify({ error: 'Invalid filename' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filePath = join(SCREENSHOT_DIR, filename);

    if (!existsSync(filePath)) {
      return new Response(JSON.stringify({ error: 'Screenshot not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Serve file efficiently via Bun.file()
    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  })

  // Manually capture screenshots
  .post('/screenshots/capture', async (context) => {
    const { body } = context;
    try {
      const results = await captureScreenshots(body as ScreenshotOptions);
      return {
        success: true,
        screenshots: results,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        screenshots: [],
      };
    }
  })

  // Capture all page screenshots (only changed pages when changedFiles is specified)
  .post('/screenshots/capture-all', async (context) => {
    const body = context.body as ScreenshotOptions & { changedFiles?: string[] };
    try {
      if (!body.workingDirectory) {
        return {
          success: false,
          error: 'workingDirectory is required',
          screenshots: [],
        };
      }
      const results = await captureAllScreenshots(body);
      return {
        success: true,
        screenshots: results,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        screenshots: [],
      };
    }
  })

  // Detect all page routes in a project
  .post('/screenshots/detect-pages', async (context) => {
    const { body } = context;
    try {
      const { workingDirectory } = body as { workingDirectory?: string };
      if (!workingDirectory) {
        return { success: false, error: 'workingDirectory is required' };
      }

      const pages = detectAllPages(workingDirectory);
      const projectInfo = detectProjectInfo(workingDirectory);
      return {
        success: true,
        project: projectInfo,
        pages,
        totalPages: pages.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Detect project structure
  .post('/screenshots/detect-project', async (context) => {
    const { body } = context;
    try {
      const { workingDirectory } = body as { workingDirectory?: string };
      if (!workingDirectory) {
        return { error: 'workingDirectory is required' };
      }

      const projectInfo = detectProjectInfo(workingDirectory);
      return {
        success: true,
        project: projectInfo,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
