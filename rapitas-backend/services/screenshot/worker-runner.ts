/**
 * Screenshot Service — WorkerRunner
 *
 * Runs screenshot capture in a Node.js subprocess via screenshot-worker.cjs.
 * Bun's Playwright pipe connections hang, so the worker runs as a Node.js process.
 * Parses NDJSON output from the worker and handles timeouts gracefully.
 *
 * NOTE: See https://github.com/oven-sh/bun/issues/23826 for the Bun/Playwright issue.
 */

import { join } from 'path';
import { spawn } from 'child_process';
import { createLogger } from '../../config/logger';
import type { ScreenshotResult } from './types';

const log = createLogger('screenshot-service:worker');

/**
 * Parse NDJSON (one JSON object per line) into an array of ScreenshotResult objects.
 *
 * @param stdout - Raw stdout string from the worker process / ワーカーの標準出力文字列
 * @returns Array of parsed ScreenshotResult objects
 */
function parseNdjson(stdout: string): ScreenshotResult[] {
  const results: ScreenshotResult[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // Skip unparseable lines
    }
  }
  return results;
}

/**
 * Spawn the screenshot worker as a Node.js subprocess and return its results.
 *
 * @param workerInput - Input configuration passed to the worker via stdin / ワーカーへのstdin入力
 * @returns Array of ScreenshotResult objects (partial results on timeout)
 */
export function runScreenshotWorker(workerInput: Record<string, unknown>): Promise<ScreenshotResult[]> {
  return new Promise((resolve, reject) => {
    const workerPath = join(import.meta.dir, '..', 'screenshot-worker.cjs');
    const child = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows: prevent Chromium from inheriting handles
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const cleanup = () => {
      try {
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.removeAllListeners();
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      } catch (e) {
        // Process cleanup errors are non-critical
      }
    };

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      process.stderr.write(msg);
    });

    child.on('close', (code: number | null) => {
      if (resolved) return;
      resolved = true;
      if (code !== 0 && code !== null) {
        log.error(`[ScreenshotService] Worker exited with code ${code}`);
      }

      const results = parseNdjson(stdout);
      cleanup();
      resolve(results);
    });

    child.on('error', (err: Error) => {
      if (resolved) return;
      resolved = true;
      log.error(`[ScreenshotService] Failed to spawn worker: ${err.message}`);
      cleanup();
      resolve([]);
    });

    child.stdin.write(JSON.stringify(workerInput));
    child.stdin.end();

    // Dynamic timeout: 30s base + 35s per page
    const pages = (workerInput.pages as Array<unknown>) || [];
    const timeoutMs = 30000 + pages.length * 35000;
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // Recover partial results from NDJSON output so far
      const partialResults = parseNdjson(stdout);
      log.error(
        `[ScreenshotService] Worker timed out after ${timeoutMs / 1000}s, recovered ${partialResults.length} screenshot(s)`,
      );
      cleanup();
      resolve(partialResults);
    }, timeoutMs);
  });
}
