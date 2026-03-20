/**
 * Screenshot Service — Types
 *
 * Shared type definitions for screenshot capture, project detection, and options.
 * Not responsible for any runtime behavior.
 */

export type ScreenshotResult = {
  id: string;
  filename: string;
  path: string;
  url: string;
  page: string;
  label: string;
  capturedAt: string;
};

export type ScreenshotOptions = {
  baseUrl?: string;
  pages?: Array<{ path: string; label: string }>;
  viewport?: { width: number; height: number };
  waitMs?: number;
  darkMode?: boolean;
  workingDirectory?: string;
  /** Max pages to capture (default: 5, 30 in all-pages mode) */
  maxPages?: number;
};

export type ProjectInfo = {
  type: 'nextjs' | 'vite' | 'cra' | 'nuxt' | 'angular' | 'unknown';
  frontendDir: string | null;
  devPort: number;
  baseUrl: string;
  srcDir: string | null;
  appDir: string | null;
  pagesDir: string | null;
};
