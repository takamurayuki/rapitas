/**
 * Screenshot Service — DirScanner
 *
 * Recursively scans Next.js App Router, Pages Router, Vite views, and Angular routing
 * directories to enumerate all available pages.
 * Not responsible for UI change detection or diff-based page selection.
 */

import { join, relative } from 'path';
import { Dirent, existsSync, readdirSync } from 'fs';
import { detectProjectInfo } from './project-detector';

/**
 * Scan a Next.js App Router directory for page.tsx files.
 *
 * @param dir - Current directory to scan / スキャン対象ディレクトリ
 * @param appRoot - Root app directory for relative path calculation / 相対パス計算用ルートディレクトリ
 * @param addPage - Callback to register a discovered page / ページ登録コールバック
 */
export function scanNextJsAppDir(
  dir: string,
  appRoot: string,
  addPage: (path: string, label: string) => void,
) {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const hasPage = entries.some((e) => !e.isDirectory() && /^page\.[tj]sx?$/.test(e.name));

  if (hasPage) {
    const relPath = relative(appRoot, dir).replace(/\\/g, '/');
    // Skip dynamic routes (e.g., [id])
    if (!relPath.includes('[')) {
      const routePath = relPath === '' ? '/' : `/${relPath}`;
      const label =
        routePath === '/' ? 'home' : routePath.split('/').filter(Boolean).pop() || routePath;
      addPage(routePath, label);
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
      scanNextJsAppDir(join(dir, entry.name), appRoot, addPage);
    }
  }
}

/**
 * Scan a Next.js Pages Router or Nuxt pages directory.
 *
 * @param dir - Current directory to scan / スキャン対象ディレクトリ
 * @param pagesRoot - Root pages directory / ルートpagesディレクトリ
 * @param addPage - Callback to register a discovered page / ページ登録コールバック
 */
export function scanPagesDir(
  dir: string,
  pagesRoot: string,
  addPage: (path: string, label: string) => void,
) {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!entry.name.startsWith('_') && !entry.name.startsWith('.')) {
        scanPagesDir(fullPath, pagesRoot, addPage);
      }
      continue;
    }

    const match = entry.name.match(/^(.+)\.(tsx|jsx|vue|ts|js)$/);
    if (!match) continue;

    const fileName = match[1];
    if (fileName.startsWith('_')) continue;
    if (fileName.includes('[')) continue;

    const relDir = relative(pagesRoot, dir).replace(/\\/g, '/');
    let routePath: string;
    if (fileName === 'index') {
      routePath = relDir === '' ? '/' : `/${relDir}`;
    } else {
      routePath = relDir === '' ? `/${fileName}` : `/${relDir}/${fileName}`;
    }

    const label =
      routePath === '/' ? 'home' : routePath.split('/').filter(Boolean).pop() || routePath;
    addPage(routePath, label);
  }
}

/**
 * Scan a Vite/CRA views directory for component files.
 *
 * @param dir - Current directory to scan / スキャン対象ディレクトリ
 * @param viewsRoot - Root views directory / ルートviewsディレクトリ
 * @param addPage - Callback to register a discovered page / ページ登録コールバック
 */
export function scanViewsDir(
  dir: string,
  viewsRoot: string,
  addPage: (path: string, label: string) => void,
) {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      scanViewsDir(fullPath, viewsRoot, addPage);
      continue;
    }

    const match = entry.name.match(/^(.+)\.(tsx|jsx|vue|svelte)$/);
    if (!match) continue;

    const fileName = match[1];
    const relDir = relative(viewsRoot, dir).replace(/\\/g, '/');
    let routePath: string;
    if (fileName.toLowerCase() === 'index' || fileName.toLowerCase() === 'home') {
      routePath = relDir === '' ? '/' : `/${relDir}`;
    } else {
      routePath =
        relDir === '' ? `/${fileName.toLowerCase()}` : `/${relDir}/${fileName.toLowerCase()}`;
    }

    const label =
      routePath === '/' ? 'home' : routePath.split('/').filter(Boolean).pop() || routePath;
    addPage(routePath, label);
  }
}

/**
 * Scan Angular routing files to discover app routes.
 *
 * @param srcDir - Angular src directory / Angularsrcディレクトリ
 * @param addPage - Callback to register a discovered page / ページ登録コールバック
 */
export function scanAngularRoutes(srcDir: string, addPage: (path: string, label: string) => void) {
  const routingFiles = [
    join(srcDir, 'app', 'app-routing.module.ts'),
    join(srcDir, 'app', 'app.routes.ts'),
  ];

  for (const routingFile of routingFiles) {
    if (!existsSync(routingFile)) continue;

    try {
      const content = require('fs').readFileSync(routingFile, 'utf-8');
      const pathPattern = /path\s*:\s*['"]([^'"]*)['"]/g;
      let match;
      while ((match = pathPattern.exec(content)) !== null) {
        const routePath = match[1];
        if (routePath === '' || routePath === '**' || routePath.includes(':')) {
          if (routePath === '') {
            addPage('/', 'home');
          }
          continue;
        }
        addPage(`/${routePath}`, routePath.split('/').pop() || routePath);
      }
    } catch {
      // ignore parse errors
    }
  }
}

/**
 * Detect pages mentioned in agent output text (URL patterns and file references).
 *
 * @param output - Agent output string to parse / パース対象のエージェント出力
 * @param workingDirectory - Optional working directory for port detection
 * @returns Array of page path/label pairs
 */
export function detectPagesFromAgentOutput(
  output: string,
  workingDirectory?: string,
): Array<{ path: string; label: string }> {
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();

  const projectInfo = workingDirectory ? detectProjectInfo(workingDirectory) : null;
  const port = projectInfo?.devPort || 3000;

  // localhost:PORT/path
  const urlPattern = new RegExp(`(?:https?://)?localhost:${port}(/[\\w\\-/]*)`, 'g');
  let match;
  while ((match = urlPattern.exec(output)) !== null) {
    const pagePath = match[1] || '/';
    if (!addedPaths.has(pagePath)) {
      addedPaths.add(pagePath);
      pages.push({
        path: pagePath,
        label: pagePath === '/' ? 'home' : pagePath.split('/').pop() || pagePath,
      });
    }
  }

  // src/app/xxx/page.tsx file mentions
  const appRouterMentionPattern = /src\/app\/([^\s/]+(?:\/[^\s/]+)*)\/page\.[tj]sx?/g;
  while ((match = appRouterMentionPattern.exec(output)) !== null) {
    const pagePath = `/${match[1]}`;
    if (!addedPaths.has(pagePath)) {
      addedPaths.add(pagePath);
      pages.push({ path: pagePath, label: pagePath.split('/').pop() || pagePath });
    }
  }

  return pages;
}
