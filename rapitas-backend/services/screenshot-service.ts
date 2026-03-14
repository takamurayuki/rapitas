/**
 * Screenshot Service
 *
 * Captures frontend screenshots using Playwright.
 * Supports any project type (Next.js, Vite, CRA, etc.).
 *
 * NOTE: In Bun, Playwright pipe connections hang, so the screenshot
 * worker runs as a Node.js subprocess instead.
 */
import { join, basename, relative } from 'path';
import { Dirent, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createLogger } from '../config/logger';

const log = createLogger('screenshot-service');

const SCREENSHOT_DIR = join(process.cwd(), 'uploads', 'screenshots');

// Initialize screenshot save directory
function ensureScreenshotDir() {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

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

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Auto-detect project structure from the working directory.
 */
export function detectProjectInfo(workingDirectory: string): ProjectInfo {
  const result: ProjectInfo = {
    type: 'unknown',
    frontendDir: null,
    devPort: 3000,
    baseUrl: 'http://localhost:3000',
    srcDir: null,
    appDir: null,
    pagesDir: null,
  };

  // Search for frontend directory candidates
  const frontendDirCandidates = [
    '', // When frontend is in root directory
    'frontend',
    'client',
    'web',
    'app',
  ];

  // Add project-specific frontend directory (e.g., rapitas-frontend)
  const projectName = basename(workingDirectory);
  frontendDirCandidates.push(`${projectName}-frontend`);

  // Search child directories for frontend candidates
  try {
    const entries = require('fs').readdirSync(workingDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('-frontend')) {
        if (!frontendDirCandidates.includes(entry.name)) {
          frontendDirCandidates.push(entry.name);
        }
      }
    }
  } catch {
    // ignore
  }

  for (const candidate of frontendDirCandidates) {
    const dir = candidate ? join(workingDirectory, candidate) : workingDirectory;
    const packageJsonPath = join(dir, 'package.json');

    if (!existsSync(packageJsonPath)) continue;

    let packageJson: PackageJson;
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      continue;
    }

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Next.js
    if (deps?.next) {
      result.type = 'nextjs';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'nextjs') || 3000;

      // src/app (App Router) or src/pages (Pages Router) or app/ or pages/
      if (existsSync(join(dir, 'src', 'app'))) {
        result.srcDir = join(dir, 'src');
        result.appDir = join(dir, 'src', 'app');
      } else if (existsSync(join(dir, 'app'))) {
        result.appDir = join(dir, 'app');
      }
      if (existsSync(join(dir, 'src', 'pages'))) {
        result.srcDir = result.srcDir || join(dir, 'src');
        result.pagesDir = join(dir, 'src', 'pages');
      } else if (existsSync(join(dir, 'pages'))) {
        result.pagesDir = join(dir, 'pages');
      }
      break;
    }

    // Vite (React, Vue, Svelte)
    if (deps?.vite) {
      result.type = 'vite';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'vite') || 5173;
      if (existsSync(join(dir, 'src'))) {
        result.srcDir = join(dir, 'src');
      }
      break;
    }

    // Create React App
    if (deps?.['react-scripts']) {
      result.type = 'cra';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'cra') || 3000;
      if (existsSync(join(dir, 'src'))) {
        result.srcDir = join(dir, 'src');
      }
      break;
    }

    // Nuxt
    if (deps?.nuxt) {
      result.type = 'nuxt';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'nuxt') || 3000;
      if (existsSync(join(dir, 'pages'))) {
        result.pagesDir = join(dir, 'pages');
      }
      break;
    }

    // Angular
    if (deps?.['@angular/core']) {
      result.type = 'angular';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'angular') || 4200;
      if (existsSync(join(dir, 'src'))) {
        result.srcDir = join(dir, 'src');
      }
      break;
    }
  }

  result.baseUrl = `http://localhost:${result.devPort}`;
  return result;
}

/**
 * Detect dev server port from config files.
 */
function detectPort(dir: string, projectType: string): number | null {
  try {
    // Check package.json scripts section
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const devScript = pkg.scripts?.dev || pkg.scripts?.start || '';
      const portMatch = devScript.match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
      if (portMatch) {
        return parseInt(portMatch[1] || portMatch[2] || portMatch[3]);
      }
    }

    // Next.js: next.config.js / next.config.ts
    if (projectType === 'nextjs') {
      // .env
      const envPath = join(dir, '.env');
      if (existsSync(envPath)) {
        const env = readFileSync(envPath, 'utf-8');
        const match = env.match(/PORT=(\d+)/);
        if (match) return parseInt(match[1]);
      }
    }

    // Vite: vite.config.ts / vite.config.js
    if (projectType === 'vite') {
      for (const configFile of ['vite.config.ts', 'vite.config.js']) {
        const configPath = join(dir, configFile);
        if (existsSync(configPath)) {
          const content = readFileSync(configPath, 'utf-8');
          const match = content.match(/port\s*:\s*(\d+)/);
          if (match) return parseInt(match[1]);
        }
      }
    }

    // Angular: angular.json
    if (projectType === 'angular') {
      const angularJsonPath = join(dir, 'angular.json');
      if (existsSync(angularJsonPath)) {
        const angularJson = JSON.parse(readFileSync(angularJsonPath, 'utf-8'));
        const projects = angularJson.projects || {};
        for (const projName of Object.keys(projects)) {
          const port = projects[projName]?.architect?.serve?.options?.port;
          if (port) return port;
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return null;
}

/**
 * Check if file changes affect UI components that require screenshots.
 *
 * Returns true when:
 * 1. Page components are modified (page.tsx, Client.tsx)
 * 2. Important CSS files are changed
 * 3. Feature components are updated (affecting user-facing UI)
 *
 * Excludes:
 * - Common/shared components (components/common/, components/ui/)
 * - Utilities and helpers (utils/, helpers/)
 * - Type definitions (*.d.ts, types/)
 * - Test files (*.test.*, *.spec.*)
 * - Store/hook files (stores/, hooks/) unless they affect UI directly
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

    // Return false if matches exclusion patterns
    if (excludePatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    // Check for UI file extensions (including CSS)
    const isUIExtension =
      normalized.endsWith('.tsx') ||
      normalized.endsWith('.jsx') ||
      normalized.endsWith('.vue') ||
      normalized.endsWith('.svelte');

    // Check for important CSS files
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

    // Check for important UI file patterns
    const importantUIPatterns = [
      /\/page\.[tj]sx?$/,
      /[A-Z]\w*Client\.[tj]sx?$/,
      /\/views\/[^/]+\.[tj]sx?$/,

      /\/layout\.[tj]sx?$/,
      /\/Layout\.[tj]sx?$/,

      /\/App\.[tj]sx?$/,
      /\/_app\.[tj]sx?$/,
      /\/index\.[tj]sx?$/,

      // Feature components affecting user-visible UI
      /\/feature\/[^/]+\/components\/[^/]+Panel\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+View\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+Page\.[tj]sx?$/,
    ];

    // Return true if matches important UI patterns
    return importantUIPatterns.some((pattern) => pattern.test(normalized)) || isImportantCSS;
  });
}

/**
 * Detect pages affected by file changes for targeted screenshot capture.
 *
 * Strategy:
 * - Page components (page.tsx, Client.tsx) → capture corresponding route
 * - Feature components → capture feature-mapped pages
 * - Layout components → capture 1 representative page
 * - Global CSS → capture home page
 */
export function detectAffectedPages(
  changedFiles: string[],
  workingDirectory?: string,
): Array<{ path: string; label: string }> {
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();
  const affectedFeatures = new Set<string>();

  function addPage(path: string, label: string) {
    // Skip dynamic routes with parameters (e.g., [id])
    if (path.includes('[')) return;
    if (!addedPaths.has(path)) {
      addedPaths.add(path);
      pages.push({ path, label });
    }
  }

  // Feature-to-page mapping (prevents duplicate screenshots)
  // Maps feature names to their primary pages
  const featurePageMapping: Record<string, Array<{ path: string; label: string }>> = {
    'developer-mode': [
      { path: '/approvals', label: 'approvals' }, // Limited to 1 page
    ],
    calendar: [{ path: '/calendar', label: 'calendar' }],
    tasks: [
      { path: '/', label: 'home' }, // Main page where task list is displayed
    ],
  };

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');

    // Only process UI-related files
    const isUIFile =
      normalized.endsWith('.tsx') ||
      normalized.endsWith('.jsx') ||
      normalized.endsWith('.vue') ||
      normalized.endsWith('.svelte') ||
      normalized.endsWith('.css') ||
      normalized.endsWith('.scss');

    if (!isUIFile) continue;

    // 1. Next.js App Router: src/app/xxx/page.tsx or xxxClient.tsx → /xxx
    const appRouterMatch = normalized.match(
      /(?:[\w-]+\/)?src\/app\/(.+?)\/(?:page\.[tj]sx?|[A-Z]\w*Client\.[tj]sx?)/,
    );
    if (appRouterMatch) {
      const routePath = `/${appRouterMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // 2. Next.js App Router: Root page.tsx (src/app/page.tsx)
    if (/(?:[\w-]+\/)?src\/app\/page\.[tj]sx?$/.test(normalized)) {
      addPage('/', 'home');
      continue;
    }

    // 3. Next.js App Router: layout.tsx affects route → capture 1 page
    const layoutMatch = normalized.match(/(?:[\w-]+\/)?src\/app\/(.+?)\/layout\.[tj]sx?/);
    if (layoutMatch) {
      const routePath = `/${layoutMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // 4. Root layout.tsx
    if (/(?:[\w-]+\/)?src\/app\/layout\.[tj]sx?$/.test(normalized)) {
      addPage('/', 'home');
      continue;
    }

    // 5. Next.js App Router (no src): app/xxx/page.tsx → /xxx
    const appDirMatch = normalized.match(/app\/(.+?)\/(?:page\.[tj]sx?|[A-Z]\w*Client\.[tj]sx?)/);
    if (appDirMatch && !normalized.includes('src/app/')) {
      const routePath = `/${appDirMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // 6. Next.js Pages Router / Nuxt: pages/xxx.tsx → /xxx
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

    // 7. Vue Router / React Router: views/xxx.vue or views/xxx.tsx
    const viewsMatch = normalized.match(/views\/(.+?)\.[tj]sx?$|views\/(.+?)\.vue$/);
    if (viewsMatch) {
      const viewName = (viewsMatch[1] || viewsMatch[2]).replace(/\/index$/, '');
      const routePath = `/${viewName.toLowerCase()}`;
      addPage(routePath, viewName.split('/').pop() || viewName);
      continue;
    }

    // 8. feature  →
    const featureMatch = normalized.match(/src\/feature\/([^/]+)\/components\/([^/]+)\.[tj]sx?$/);
    if (featureMatch) {
      const featureName = featureMatch[1];
      const componentName = featureMatch[2];

      // （Panel, View, Page）
      if (
        componentName.endsWith('Panel') ||
        componentName.endsWith('View') ||
        componentName.endsWith('Page') ||
        componentName.includes('Client')
      ) {
        // feature（）
        if (affectedFeatures.has(featureName)) {
          continue;
        }
        affectedFeatures.add(featureName);

        const mappedPages = featurePageMapping[featureName];
        if (mappedPages && mappedPages.length > 0) {
          // 1
          addPage(mappedPages[0].path, mappedPages[0].label);
        }
      }
      continue;
    }

    // 9. src/app/xxx/
    // （page.tsx  *Client.tsx ）

    // 10. CSS  →
    if (
      normalized.includes('globals.css') ||
      normalized.includes('global.css') ||
      normalized.includes('index.css')
    ) {
      addPage('/', 'home');
      continue;
    }

    // 11. （）
  }

  return pages;
}

/**
 * Next.js App Router / Pages RouterViteNuxtAngular
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

  // Next.js App Router: src/app/**/page.tsx
  if (projectInfo.appDir && existsSync(projectInfo.appDir)) {
    scanNextJsAppDir(projectInfo.appDir, projectInfo.appDir, addPage);
  }

  // Next.js Pages Router: pages/**/*.tsx
  if (projectInfo.pagesDir && existsSync(projectInfo.pagesDir)) {
    scanPagesDir(projectInfo.pagesDir, projectInfo.pagesDir, addPage);
  }

  // Vite / CRA: src/views/  src/pages/
  if (projectInfo.srcDir && (projectInfo.type === 'vite' || projectInfo.type === 'cra')) {
    const viewsDir = join(projectInfo.srcDir, 'views');
    if (existsSync(viewsDir)) {
      scanViewsDir(viewsDir, viewsDir, addPage);
    }
    const pagesDir = join(projectInfo.srcDir, 'pages');
    if (existsSync(pagesDir)) {
      scanPagesDir(pagesDir, pagesDir, addPage);
    }
  }

  // Nuxt: pages/*.vue
  if (projectInfo.type === 'nuxt' && projectInfo.pagesDir) {
    scanPagesDir(projectInfo.pagesDir, projectInfo.pagesDir, addPage);
  }

  // Angular: app-routing.module.ts
  if (projectInfo.type === 'angular' && projectInfo.srcDir) {
    scanAngularRoutes(projectInfo.srcDir, addPage);
  }

  if (pages.length === 0 || !addedPaths.has('/')) {
    addPage('/', 'home');
  }

  return pages;
}

/**
 * Next.js App Router  page.tsx
 */
function scanNextJsAppDir(
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

  // page.tsx / page.jsx
  const hasPage = entries.some((e) => !e.isDirectory() && /^page\.[tj]sx?$/.test(e.name));

  if (hasPage) {
    const relPath = relative(appRoot, dir).replace(/\\/g, '/');
    // （[id]）（）
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
 * Pages Router / Nuxt pages
 */
function scanPagesDir(
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

    // .tsx, .jsx, .vue
    const match = entry.name.match(/^(.+)\.(tsx|jsx|vue|ts|js)$/);
    if (!match) continue;

    const fileName = match[1];
    // _app, _document, _error
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
 * Vite/CRA  views
 */
function scanViewsDir(
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
 * Angular
 */
function scanAngularRoutes(srcDir: string, addPage: (path: string, label: string) => void) {
  // app-routing.module.ts
  const routingFiles = [
    join(srcDir, 'app', 'app-routing.module.ts'),
    join(srcDir, 'app', 'app.routes.ts'),
  ];

  for (const routingFile of routingFiles) {
    if (!existsSync(routingFile)) continue;

    try {
      const content = readFileSync(routingFile, 'utf-8');
      // path: 'xxx'
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
      // ignore
    }
  }
}

/**
 * Node.js
 *
 * Bun  Playwright  pipe （--remote-debugging-pipe）
 * Node.js
 * NDJSON（11JSON）Output
 * : https://github.com/oven-sh/bun/issues/23826
 */

/**
 * NDJSON（11JSON） ScreenshotResult
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

function runScreenshotWorker(workerInput: Record<string, unknown>): Promise<ScreenshotResult[]> {
  return new Promise((resolve, reject) => {
    const workerPath = join(import.meta.dir, 'screenshot-worker.cjs');
    const child = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows: （Chromium）
      // child.kill()
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
      // Output
      process.stderr.write(msg);
    });

    child.on('close', (code: number | null) => {
      if (resolved) return;
      resolved = true;
      if (code !== 0 && code !== null) {
        log.error(`[ScreenshotService] Worker exited with code ${code}`);
      }

      // NDJSON （11）
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

    // stdin
    child.stdin.write(JSON.stringify(workerInput));
    child.stdin.end();

    // : （135 + 30）
    const pages = (workerInput.pages as Array<unknown>) || [];
    const timeoutMs = 30000 + pages.length * 35000;
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // （NDJSON Output）
      const partialResults = parseNdjson(stdout);
      log.error(
        `[ScreenshotService] Worker timed out after ${timeoutMs / 1000}s, recovered ${partialResults.length} screenshot(s)`,
      );
      cleanup();
      resolve(partialResults);
    }, timeoutMs);
  });
}

/**
 * Playwright
 * Bun  Node.js
 */
export async function captureScreenshots(
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult[]> {
  // （90）
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

  // workingDirectory baseUrl
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

  // : 5
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
 *
 * changedFiles
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
    // diff:
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

  // maxPages 5（）
  return captureScreenshots({
    ...options,
    pages: targetPages,
    maxPages: options.maxPages || 5,
    workingDirectory,
  });
}

/**
 * AIOutput
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

  // src/app/xxx/page.tsx
  const appRouterMentionPattern = /src\/app\/([^\s/]+(?:\/[^\s/]+)*)\/page\.[tj]sx?/g;
  while ((match = appRouterMentionPattern.exec(output)) !== null) {
    const pagePath = `/${match[1]}`;
    if (!addedPaths.has(pagePath)) {
      addedPaths.add(pagePath);
      pages.push({
        path: pagePath,
        label: pagePath.split('/').pop() || pagePath,
      });
    }
  }

  return pages;
}

/**
 * structuredDiffOutput
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

  // Output
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
    // UI
    pages.push({ path: '/', label: 'home' });
  }

  // （: 3）
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
