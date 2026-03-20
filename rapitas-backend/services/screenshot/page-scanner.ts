/**
 * Screenshot Service — PageScanner
 *
 * Detects which pages are affected by file changes and enumerates all available pages
 * in Next.js, Vite, CRA, Nuxt, and Angular projects.
 * Not responsible for directory scanning internals (see dir-scanner.ts) or screenshot capture.
 */

import { join, basename } from 'path';
import { existsSync } from 'fs';
import { detectProjectInfo } from './project-detector';
import {
  scanNextJsAppDir,
  scanPagesDir,
  scanViewsDir,
  scanAngularRoutes,
  detectPagesFromAgentOutput,
} from './dir-scanner';

export { detectPagesFromAgentOutput };

/**
 * Check if file changes affect UI components that require screenshots.
 *
 * Returns true when page/layout/feature components or global CSS are changed.
 * Excludes utility, hook, store, API, test, and shared component files.
 *
 * @param changedFiles - List of changed file paths / 変更されたファイルパスのリスト
 * @param workingDirectory - Optional working directory for project type detection
 * @returns true if any changed file affects the visible UI
 */
export function hasUIChanges(changedFiles: string[], workingDirectory?: string): boolean {
  const projectInfo = workingDirectory ? detectProjectInfo(workingDirectory) : null;

  return changedFiles.some((file) => {
    const normalized = file.replace(/\\/g, '/');

    const excludePatterns = [
      /\/components\/common\//,
      /\/components\/ui\//,
      /\/components\/shared\//,
      /\/utils\//,
      /\/helpers\//,
      /\/lib\//,
      /\/hooks\//,
      /\/stores\//,
      /\/services\//,
      /\/api\//,
      /\/types\//,
      /\.d\.ts$/,
      /\.test\.[tj]sx?$/,
      /\.spec\.[tj]sx?$/,
      /\.stories\.[tj]sx?$/,
      /__tests__\//,
      /__mocks__\//,
    ];

    if (excludePatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    const isUIExtension =
      normalized.endsWith('.tsx') ||
      normalized.endsWith('.jsx') ||
      normalized.endsWith('.vue') ||
      normalized.endsWith('.svelte');

    const isImportantCSS =
      normalized.endsWith('globals.css') ||
      normalized.endsWith('global.css') ||
      normalized.endsWith('index.css') ||
      normalized.endsWith('app.css') ||
      normalized.endsWith('main.css');

    if (!isUIExtension && !isImportantCSS) return false;

    if (projectInfo && projectInfo.type !== 'unknown') {
      const frontendDirName = projectInfo.frontendDir ? basename(projectInfo.frontendDir) : null;
      if (frontendDirName && !normalized.includes(`${frontendDirName}/`)) {
        return false;
      }
    }

    const importantUIPatterns = [
      /\/page\.[tj]sx?$/,
      /[A-Z]\w*Client\.[tj]sx?$/,
      /\/views\/[^/]+\.[tj]sx?$/,
      /\/layout\.[tj]sx?$/,
      /\/Layout\.[tj]sx?$/,
      /\/App\.[tj]sx?$/,
      /\/_app\.[tj]sx?$/,
      /\/index\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+Panel\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+View\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+Page\.[tj]sx?$/,
    ];

    return importantUIPatterns.some((pattern) => pattern.test(normalized)) || isImportantCSS;
  });
}

/**
 * Detect pages affected by file changes for targeted screenshot capture.
 *
 * @param changedFiles - List of changed file paths / 変更されたファイルパスのリスト
 * @param workingDirectory - Optional working directory for project type detection
 * @returns Array of page path/label pairs to screenshot
 */
export function detectAffectedPages(
  changedFiles: string[],
  workingDirectory?: string,
): Array<{ path: string; label: string }> {
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();
  const affectedFeatures = new Set<string>();

  function addPage(path: string, label: string) {
    if (path.includes('[')) return;
    if (!addedPaths.has(path)) {
      addedPaths.add(path);
      pages.push({ path, label });
    }
  }

  // Feature-to-page mapping: maps feature names to their primary pages
  const featurePageMapping: Record<string, Array<{ path: string; label: string }>> = {
    'developer-mode': [{ path: '/approvals', label: 'approvals' }],
    calendar: [{ path: '/calendar', label: 'calendar' }],
    tasks: [{ path: '/', label: 'home' }],
  };

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');

    const isUIFile =
      normalized.endsWith('.tsx') || normalized.endsWith('.jsx') ||
      normalized.endsWith('.vue') || normalized.endsWith('.svelte') ||
      normalized.endsWith('.css') || normalized.endsWith('.scss');

    if (!isUIFile) continue;

    // Next.js App Router: src/app/xxx/page.tsx or xxxClient.tsx → /xxx
    const appRouterMatch = normalized.match(
      /(?:[\w-]+\/)?src\/app\/(.+?)\/(?:page\.[tj]sx?|[A-Z]\w*Client\.[tj]sx?)/,
    );
    if (appRouterMatch) {
      const routePath = `/${appRouterMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // Root page.tsx
    if (/(?:[\w-]+\/)?src\/app\/page\.[tj]sx?$/.test(normalized)) { addPage('/', 'home'); continue; }

    // layout.tsx
    const layoutMatch = normalized.match(/(?:[\w-]+\/)?src\/app\/(.+?)\/layout\.[tj]sx?/);
    if (layoutMatch) {
      const routePath = `/${layoutMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // Root layout.tsx
    if (/(?:[\w-]+\/)?src\/app\/layout\.[tj]sx?$/.test(normalized)) { addPage('/', 'home'); continue; }

    // App Router (no src): app/xxx/page.tsx
    const appDirMatch = normalized.match(/app\/(.+?)\/(?:page\.[tj]sx?|[A-Z]\w*Client\.[tj]sx?)/);
    if (appDirMatch && !normalized.includes('src/app/')) {
      const routePath = `/${appDirMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // Pages Router / Nuxt: pages/xxx.tsx → /xxx
    const pagesMatch = normalized.match(/pages\/(.+?)\.[tj]sx?$|pages\/(.+?)\.vue$/);
    if (pagesMatch) {
      const pageName = (pagesMatch[1] || pagesMatch[2]).replace(/\/index$/, '');
      if (pageName === 'index' || pageName === '_app' || pageName === '_document') {
        addPage('/', 'home');
      } else if (!pageName.startsWith('_')) {
        const routePath = `/${pageName}`;
        addPage(routePath, routePath.split('/').filter(Boolean).pop() || pageName);
      }
      continue;
    }

    // Views: views/xxx.vue or views/xxx.tsx
    const viewsMatch = normalized.match(/views\/(.+?)\.[tj]sx?$|views\/(.+?)\.vue$/);
    if (viewsMatch) {
      const viewName = (viewsMatch[1] || viewsMatch[2]).replace(/\/index$/, '');
      addPage(`/${viewName.toLowerCase()}`, viewName.split('/').pop() || viewName);
      continue;
    }

    // Feature components
    const featureMatch = normalized.match(/src\/feature\/([^/]+)\/components\/([^/]+)\.[tj]sx?$/);
    if (featureMatch) {
      const featureName = featureMatch[1];
      const componentName = featureMatch[2];
      if (
        componentName.endsWith('Panel') || componentName.endsWith('View') ||
        componentName.endsWith('Page') || componentName.includes('Client')
      ) {
        if (!affectedFeatures.has(featureName)) {
          affectedFeatures.add(featureName);
          const mappedPages = featurePageMapping[featureName];
          if (mappedPages?.[0]) addPage(mappedPages[0].path, mappedPages[0].label);
        }
      }
      continue;
    }

    // Global CSS → home
    if (normalized.includes('globals.css') || normalized.includes('global.css') || normalized.includes('index.css')) {
      addPage('/', 'home');
    }
  }

  return pages;
}

/**
 * Enumerate all pages across supported frameworks in the working directory.
 *
 * @param workingDirectory - Root working directory to scan / スキャンするルートディレクトリ
 * @returns Array of page path/label pairs
 */
export function detectAllPages(workingDirectory: string): Array<{ path: string; label: string }> {
  const projectInfo = detectProjectInfo(workingDirectory);
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();

  function addPage(path: string, label: string) {
    if (!addedPaths.has(path)) {
      addedPaths.add(path);
      pages.push({ path, label });
    }
  }

  if (projectInfo.appDir && existsSync(projectInfo.appDir)) {
    scanNextJsAppDir(projectInfo.appDir, projectInfo.appDir, addPage);
  }

  if (projectInfo.pagesDir && existsSync(projectInfo.pagesDir)) {
    scanPagesDir(projectInfo.pagesDir, projectInfo.pagesDir, addPage);
  }

  if (projectInfo.srcDir && (projectInfo.type === 'vite' || projectInfo.type === 'cra')) {
    const viewsDir = join(projectInfo.srcDir, 'views');
    if (existsSync(viewsDir)) scanViewsDir(viewsDir, viewsDir, addPage);
    const pagesDir = join(projectInfo.srcDir, 'pages');
    if (existsSync(pagesDir)) scanPagesDir(pagesDir, pagesDir, addPage);
  }

  if (projectInfo.type === 'nuxt' && projectInfo.pagesDir) {
    scanPagesDir(projectInfo.pagesDir, projectInfo.pagesDir, addPage);
  }

  if (projectInfo.type === 'angular' && projectInfo.srcDir) {
    scanAngularRoutes(projectInfo.srcDir, addPage);
  }

  if (pages.length === 0 || !addedPaths.has('/')) {
    addPage('/', 'home');
  }

  return pages;
}

