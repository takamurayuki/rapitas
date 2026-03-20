/**
 * Screenshot Service — Capture
 *
 * High-level screenshot capture functions: single-call, diff-based, and all-pages modes.
 * Delegates to WorkerRunner for Playwright execution and PageScanner for page detection.
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { createLogger } from '../../config/logger';
import type { ScreenshotOptions, ScreenshotResult } from './types';
import { detectProjectInfo } from './project-detector';
import {
  hasUIChanges,
  detectAffectedPages,
  detectAllPages,
  detectPagesFromAgentOutput,
} from './page-scanner';
import { runScreenshotWorker } from './worker-runner';

const log = createLogger('screenshot-service:capture');

const SCREENSHOT_DIR = join(process.cwd(), 'uploads', 'screenshots');

/** Initialize the screenshot save directory if it does not exist. */
function ensureScreenshotDir() {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

/**
 * Capture screenshots for specified pages using a Node.js worker.
 * Wraps captureScreenshotsImpl with a 90-second safety timeout.
 *
 * @param options - Screenshot options including pages, viewport, and working directory
 * @returns Array of captured ScreenshotResult objects (empty on failure)
 */
export async function captureScreenshots(
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult[]> {
  // Safety timeout: prevent hanging indefinitely (90s)
  const SAFETY_TIMEOUT_MS = 90000;
  const safetyPromise = new Promise<ScreenshotResult[]>((resolve) => {
    setTimeout(() => {
      log.error(
        `[ScreenshotService] captureScreenshots safety timeout (${SAFETY_TIMEOUT_MS / 1000}s) - returning empty results`,
      );
      resolve([]);
    }, SAFETY_TIMEOUT_MS);
  });

  try {
    const resultPromise = captureScreenshotsImpl(options);
    return await Promise.race([resultPromise, safetyPromise]);
  } catch (err) {
    log.error({ err }, '[ScreenshotService] captureScreenshots error');
    return [];
  }
}

async function captureScreenshotsImpl(
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult[]> {
  const {
    workingDirectory,
    viewport = { width: 1280, height: 720 },
    waitMs = 1500,
    darkMode = false,
    maxPages = 5,
  } = options;

  const projectInfo = workingDirectory ? detectProjectInfo(workingDirectory) : null;
  const baseUrl = options.baseUrl || (projectInfo ? projectInfo.baseUrl : 'http://localhost:3000');
  const pages = options.pages || [{ path: '/', label: 'home' }];

  ensureScreenshotDir();

  const targetPages = pages.slice(0, maxPages);

  log.info(`[ScreenshotService] Capturing ${targetPages.length} page(s) via Node.js worker`);

  const BATCH_SIZE = 5;
  if (targetPages.length <= BATCH_SIZE) {
    return runScreenshotWorker({
      baseUrl,
      pages: targetPages,
      viewport,
      waitMs,
      darkMode,
      screenshotDir: SCREENSHOT_DIR,
    });
  }

  // Batch in groups of 5 to prevent worker overload
  const allResults: ScreenshotResult[] = [];
  for (let i = 0; i < targetPages.length; i += BATCH_SIZE) {
    const batch = targetPages.slice(i, i + BATCH_SIZE);
    log.info(
      `[ScreenshotService] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(targetPages.length / BATCH_SIZE)}: ${batch.map((p) => p.path).join(', ')}`,
    );
    const results = await runScreenshotWorker({
      baseUrl,
      pages: batch,
      viewport,
      waitMs,
      darkMode,
      screenshotDir: SCREENSHOT_DIR,
    });
    allResults.push(...results);
  }
  return allResults;
}

/**
 * Capture screenshots for all detected pages, or diff-based pages when changedFiles is provided.
 *
 * @param options - Screenshot options extended with optional changedFiles / 変更ファイルを含むオプション
 * @returns Array of captured ScreenshotResult objects
 */
export async function captureAllScreenshots(
  options: ScreenshotOptions & { changedFiles?: string[] } = {},
): Promise<ScreenshotResult[]> {
  const workingDirectory = options.workingDirectory;
  if (!workingDirectory) {
    log.error('[ScreenshotService] workingDirectory is required for captureAllScreenshots');
    return [];
  }

  let targetPages: Array<{ path: string; label: string }>;

  if (options.changedFiles && options.changedFiles.length > 0) {
    if (!hasUIChanges(options.changedFiles, workingDirectory)) {
      log.info('[ScreenshotService] captureAll: no UI changes detected, skipping.');
      return [];
    }
    targetPages = detectAffectedPages(options.changedFiles, workingDirectory);
    if (targetPages.length === 0) {
      targetPages = [{ path: '/', label: 'home' }];
    }
    log.info(
      `[ScreenshotService] captureAll (diff-based): ${targetPages.length} affected page(s): ${targetPages.map((p) => p.path).join(', ')}`,
    );
  } else {
    targetPages = detectAllPages(workingDirectory);
    log.info(
      `[ScreenshotService] captureAll: detected ${targetPages.length} page(s): ${targetPages.map((p) => p.path).join(', ')}`,
    );
  }

  return captureScreenshots({
    ...options,
    pages: targetPages,
    maxPages: options.maxPages || 5,
    workingDirectory,
  });
}

/**
 * Capture screenshots based on a structured diff output, merging agent output page hints.
 *
 * @param structuredDiff - Array of diff entries with filename / diffエントリの配列
 * @param options - Optional screenshot options and agent output string
 * @returns Array of captured ScreenshotResult objects
 */
export async function captureScreenshotsForDiff(
  structuredDiff: Array<{ filename: string }>,
  options?: Partial<ScreenshotOptions> & { agentOutput?: string },
): Promise<ScreenshotResult[]> {
  const changedFiles = structuredDiff.map((d) => d.filename);
  const workingDirectory = options?.workingDirectory;

  log.info(`[ScreenshotService] captureScreenshotsForDiff: ${changedFiles.length} changed file(s)`);

  if (!hasUIChanges(changedFiles, workingDirectory)) {
    log.info('[ScreenshotService] No UI changes detected, skipping screenshots.');
    return [];
  }

  const pages = detectAffectedPages(changedFiles, workingDirectory);

  log.info(
    `[ScreenshotService] Detected ${pages.length} affected page(s) from diff: ${pages.map((p) => p.path).join(', ')}`,
  );

  // Merge additional pages detected from agent output
  if (options?.agentOutput) {
    const agentPages = detectPagesFromAgentOutput(options.agentOutput, workingDirectory);
    const existingPaths = new Set(pages.map((p) => p.path));
    for (const ap of agentPages) {
      if (!existingPaths.has(ap.path)) {
        pages.push(ap);
        existingPaths.add(ap.path);
      }
    }
  }

  if (pages.length === 0) {
    pages.push({ path: '/', label: 'home' });
  }

  // Limit to maxPages (default: 3 for diff-based mode)
  const maxPages = options?.maxPages || 3;
  const targetPages = pages.slice(0, maxPages);
  if (pages.length > maxPages) {
    log.info(`[ScreenshotService] Limiting screenshots from ${pages.length} to ${maxPages} pages`);
  }

  log.info(
    `[ScreenshotService] Capturing ${targetPages.length} page(s): ${targetPages.map((p) => p.path).join(', ')}`,
  );

  return captureScreenshots({
    ...options,
    pages: targetPages,
    maxPages,
    workingDirectory,
  });
}
