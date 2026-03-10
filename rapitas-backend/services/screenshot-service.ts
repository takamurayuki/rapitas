/**
 * Screenshot Service
 * Playwrightを使ってフロントエンド画面のスクリーンショットを撮影するサービス
 * 任意のプロジェクト（Next.js, Vite, CRA等）に対応
 *
 * Bun 環境では Playwright の pipe 接続がハングするため、
 * Node.js サブプロセスでスクリーンショットワーカーを実行する。
 */
import { join, basename, relative } from 'path';
import { Dirent, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createLogger } from '../config/logger';

const log = createLogger('screenshot-service');

const SCREENSHOT_DIR = join(process.cwd(), 'uploads', 'screenshots');

// スクリーンショット保存ディレクトリの初期化
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
  /** 最大撮影ページ数（デフォルト: 5、全ページモード時は30） */
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
 * 作業ディレクトリからプロジェクト構造を自動検出する
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

  // フロントエンドディレクトリの候補を探す
  const frontendDirCandidates = [
    '', // ルートにフロントエンドがある場合
    'frontend',
    'client',
    'web',
    'app',
  ];

  // プロジェクト名-frontend パターン（例: rapitas-frontend）
  const projectName = basename(workingDirectory);
  frontendDirCandidates.push(`${projectName}-frontend`);

  // 子ディレクトリを検索してフロントエンド候補を追加
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
 * 設定ファイルからdevサーバーのポートを検出する
 */
function detectPort(dir: string, projectType: string): number | null {
  try {
    // package.json の scripts から検出
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
      // .env ファイルからポート検出
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
 * 変更されたファイルにUI関連のファイルが含まれるかチェック（厳格版）
 *
 * スクリーンショット取得を最小限にするため、以下の条件を満たす場合のみtrueを返す：
 * 1. ページコンポーネント（page.tsx, Client.tsx）の直接的な変更
 * 2. ルートレイアウトやグローバルスタイルの変更
 * 3. 特定のfeatureコンポーネントの変更（ページに直接表示されるもの）
 *
 * 除外するもの：
 * - 共通コンポーネント（components/common/, components/ui/）
 * - ユーティリティ関数（utils/, helpers/）
 * - 型定義ファイル（*.d.ts, types/）
 * - テストファイル（*.test.*, *.spec.*）
 * - ストア・フック（stores/, hooks/）※UIに直接影響しない
 */
export function hasUIChanges(changedFiles: string[], workingDirectory?: string): boolean {
  const projectInfo = workingDirectory ? detectProjectInfo(workingDirectory) : null;

  return changedFiles.some((file) => {
    const normalized = file.replace(/\\/g, '/');

    // 除外パターン（共通コンポーネント、ユーティリティなど）
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

    // 除外パターンに該当する場合はfalse
    if (excludePatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    // UI関連の拡張子（CSSは特定の場合のみ）
    const isUIExtension =
      normalized.endsWith('.tsx') ||
      normalized.endsWith('.jsx') ||
      normalized.endsWith('.vue') ||
      normalized.endsWith('.svelte');

    // CSSファイルは特定のもののみ対象
    const isImportantCSS =
      normalized.endsWith('globals.css') ||
      normalized.endsWith('global.css') ||
      normalized.endsWith('index.css') ||
      normalized.endsWith('app.css') ||
      normalized.endsWith('main.css');

    if (!isUIExtension && !isImportantCSS) return false;

    // プロジェクト固有の判定
    if (projectInfo && projectInfo.type !== 'unknown') {
      const frontendDirName = projectInfo.frontendDir ? basename(projectInfo.frontendDir) : null;

      // フロントエンドディレクトリ外の変更は除外
      if (frontendDirName && !normalized.includes(`${frontendDirName}/`)) {
        return false;
      }
    }

    // 重要なUIファイルのパターン
    const importantUIPatterns = [
      // ページコンポーネント
      /\/page\.[tj]sx?$/,
      /[A-Z]\w*Client\.[tj]sx?$/,
      /\/views\/[^/]+\.[tj]sx?$/,

      // レイアウトコンポーネント
      /\/layout\.[tj]sx?$/,
      /\/Layout\.[tj]sx?$/,

      // ルートコンポーネント
      /\/App\.[tj]sx?$/,
      /\/_app\.[tj]sx?$/,
      /\/index\.[tj]sx?$/,

      // 特定のfeatureコンポーネント（ページに直接表示される主要コンポーネント）
      /\/feature\/[^/]+\/components\/[^/]+Panel\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+View\.[tj]sx?$/,
      /\/feature\/[^/]+\/components\/[^/]+Page\.[tj]sx?$/,
    ];

    // 重要なUIファイルの場合のみtrue
    return importantUIPatterns.some((pattern) => pattern.test(normalized)) || isImportantCSS;
  });
}

/**
 * 変更されたファイルから関連するページを推定する（厳格版）
 *
 * 精度重視: 直接的な影響があるページのみを検出
 * - ページコンポーネント（page.tsx, Client.tsx）の変更 → そのページのみ
 * - feature内の主要コンポーネント → マッピングされた特定ページのみ
 * - レイアウト変更 → そのレイアウトが適用されるページの代表的なもの1つ
 * - グローバルスタイル → ホームページのみ
 *
 * 最大撮影ページ数を制限して不要なスクリーンショットを防止する。
 */
export function detectAffectedPages(
  changedFiles: string[],
  workingDirectory?: string,
): Array<{ path: string; label: string }> {
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();
  const affectedFeatures = new Set<string>();

  function addPage(path: string, label: string) {
    // 動的ルート（[id]など）はスキップ
    if (path.includes('[')) return;
    if (!addedPaths.has(path)) {
      addedPaths.add(path);
      pages.push({ path, label });
    }
  }

  // feature ディレクトリからページへのマッピング（厳格版）
  // 各featureの主要コンポーネントが直接表示される代表的なページのみをマッピング
  const featurePageMapping: Record<string, Array<{ path: string; label: string }>> = {
    'developer-mode': [
      { path: '/approvals', label: 'approvals' }, // 最大1ページ
    ],
    calendar: [{ path: '/calendar', label: 'calendar' }],
    tasks: [
      { path: '/', label: 'home' }, // タスク一覧が表示されるメインページのみ
    ],
  };

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');

    // UI関連の拡張子チェック
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

    // 2. Next.js App Router: ルートの page.tsx (src/app/page.tsx)
    if (/(?:[\w-]+\/)?src\/app\/page\.[tj]sx?$/.test(normalized)) {
      addPage('/', 'home');
      continue;
    }

    // 3. Next.js App Router: layout.tsx の変更 → そのルートとその子ルートの1つ
    const layoutMatch = normalized.match(/(?:[\w-]+\/)?src\/app\/(.+?)\/layout\.[tj]sx?/);
    if (layoutMatch) {
      const routePath = `/${layoutMatch[1]}`;
      addPage(routePath, routePath.split('/').filter(Boolean).pop() || 'home');
      continue;
    }

    // 4. ルートの layout.tsx
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

    // 8. feature ディレクトリの変更 → 主要コンポーネントのみ対象
    const featureMatch = normalized.match(/src\/feature\/([^/]+)\/components\/([^/]+)\.[tj]sx?$/);
    if (featureMatch) {
      const featureName = featureMatch[1];
      const componentName = featureMatch[2];

      // 主要なコンポーネント（Panel, View, Page系）の場合のみ
      if (
        componentName.endsWith('Panel') ||
        componentName.endsWith('View') ||
        componentName.endsWith('Page') ||
        componentName.includes('Client')
      ) {
        // すでにこのfeatureを処理済みの場合はスキップ（重複防止）
        if (affectedFeatures.has(featureName)) {
          continue;
        }
        affectedFeatures.add(featureName);

        const mappedPages = featurePageMapping[featureName];
        if (mappedPages && mappedPages.length > 0) {
          // マッピングがある場合は最初の1ページのみ追加
          addPage(mappedPages[0].path, mappedPages[0].label);
        }
      }
      continue;
    }

    // 9. src/app/xxx/ 内の任意のコンポーネントファイル変更は無視
    // （page.tsx や *Client.tsx の直接的な変更のみを対象とする）

    // 10. グローバルCSS の変更 → トップページのみ
    if (
      normalized.includes('globals.css') ||
      normalized.includes('global.css') ||
      normalized.includes('index.css')
    ) {
      addPage('/', 'home');
      continue;
    }

    // 11. その他の変更は無視（共通コンポーネント、ユーティリティなど）
  }

  return pages;
}

/**
 * フロントエンドプロジェクトの全ページルートを自動検出する（汎用版）
 * Next.js App Router / Pages Router、Vite、Nuxt、Angular に対応
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

  // Next.js App Router: src/app/**/page.tsx を再帰的に探索
  if (projectInfo.appDir && existsSync(projectInfo.appDir)) {
    scanNextJsAppDir(projectInfo.appDir, projectInfo.appDir, addPage);
  }

  // Next.js Pages Router: pages/**/*.tsx を探索
  if (projectInfo.pagesDir && existsSync(projectInfo.pagesDir)) {
    scanPagesDir(projectInfo.pagesDir, projectInfo.pagesDir, addPage);
  }

  // Vite / CRA: src/views/ や src/pages/ を探索
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

  // Nuxt: pages/*.vue を探索
  if (projectInfo.type === 'nuxt' && projectInfo.pagesDir) {
    scanPagesDir(projectInfo.pagesDir, projectInfo.pagesDir, addPage);
  }

  // Angular: app-routing.module.ts からルートを抽出
  if (projectInfo.type === 'angular' && projectInfo.srcDir) {
    scanAngularRoutes(projectInfo.srcDir, addPage);
  }

  // ホームページが含まれていない場合は追加
  if (pages.length === 0 || !addedPaths.has('/')) {
    addPage('/', 'home');
  }

  return pages;
}

/**
 * Next.js App Router ディレクトリを再帰スキャンして page.tsx を探す
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

  // page.tsx / page.jsx が存在するかチェック
  const hasPage = entries.some((e) => !e.isDirectory() && /^page\.[tj]sx?$/.test(e.name));

  if (hasPage) {
    const relPath = relative(appRoot, dir).replace(/\\/g, '/');
    // 動的ルート（[id]など）はスキップ（実データが必要なため）
    if (!relPath.includes('[')) {
      const routePath = relPath === '' ? '/' : `/${relPath}`;
      const label =
        routePath === '/' ? 'home' : routePath.split('/').filter(Boolean).pop() || routePath;
      addPage(routePath, label);
    }
  }

  // サブディレクトリを再帰探索
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
      scanNextJsAppDir(join(dir, entry.name), appRoot, addPage);
    }
  }
}

/**
 * Pages Router / Nuxt のpagesディレクトリをスキャン
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

    // .tsx, .jsx, .vue ファイルを対象
    const match = entry.name.match(/^(.+)\.(tsx|jsx|vue|ts|js)$/);
    if (!match) continue;

    const fileName = match[1];
    // _app, _document, _error などはスキップ
    if (fileName.startsWith('_')) continue;
    // 動的ルートはスキップ
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
 * Vite/CRA の views ディレクトリをスキャン
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
 * Angular のルーティングモジュールからルートを抽出
 */
function scanAngularRoutes(srcDir: string, addPage: (path: string, label: string) => void) {
  // app-routing.module.ts からパスを抽出
  const routingFiles = [
    join(srcDir, 'app', 'app-routing.module.ts'),
    join(srcDir, 'app', 'app.routes.ts'),
  ];

  for (const routingFile of routingFiles) {
    if (!existsSync(routingFile)) continue;

    try {
      const content = readFileSync(routingFile, 'utf-8');
      // path: 'xxx' パターンを抽出
      const pathPattern = /path\s*:\s*['"]([^'"]*)['"]/g;
      let match;
      while ((match = pathPattern.exec(content)) !== null) {
        const routePath = match[1];
        // 空パス、ワイルドカード、動的パラメータはスキップ
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
 * Node.js サブプロセスでスクリーンショットワーカーを実行する
 *
 * Bun 環境では Playwright の pipe 接続（--remote-debugging-pipe）が
 * ハングするため、Node.js サブプロセスとして実行する。
 * ワーカーは NDJSON（1行1JSON）で逐次出力し、タイムアウト時も途中結果を回収可能。
 * 参考: https://github.com/oven-sh/bun/issues/23826
 */

/**
 * NDJSON（1行1JSON）をパースして ScreenshotResult 配列を返す
 */
function parseNdjson(stdout: string): ScreenshotResult[] {
  const results: ScreenshotResult[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // パース不能行はスキップ
    }
  }
  return results;
}

function runScreenshotWorker(workerInput: Record<string, unknown>): Promise<ScreenshotResult[]> {
  return new Promise((resolve, reject) => {
    const workerPath = join(import.meta.dir, 'screenshot-worker.cjs');
    const child = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows: 子プロセスとそのサブプロセス（Chromium等）を独立したプロセスグループで起動しない
      // これにより、child.kill() で確実にクリーンアップできる
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const cleanup = () => {
      try {
        // パイプを明示的に破棄してリソースリークを防止
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
      // ワーカーのログをそのまま出力
      process.stderr.write(msg);
    });

    child.on('close', (code: number | null) => {
      if (resolved) return;
      resolved = true;
      if (code !== 0 && code !== null) {
        log.error(`[ScreenshotService] Worker exited with code ${code}`);
      }

      // NDJSON 形式でパース（1行1結果）
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

    // stdin にオプションを書き込んで閉じる
    child.stdin.write(JSON.stringify(workerInput));
    child.stdin.end();

    // タイムアウト: ページ数に応じて動的に設定（1ページあたり35秒 + ブラウザ起動30秒）
    const pages = (workerInput.pages as Array<unknown>) || [];
    const timeoutMs = 30000 + pages.length * 35000;
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // タイムアウト時も途中結果を返す（NDJSON で逐次出力されている分を回収）
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
 * Playwrightを使ってスクリーンショットを撮影する
 * Bun 互換性のため Node.js サブプロセスで実行
 */
export async function captureScreenshots(
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult[]> {
  // スクリーンショット撮影全体のセーフティタイムアウト（90秒）
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

  // workingDirectory からプロジェクト情報を自動検出し、baseUrl を決定
  const projectInfo = workingDirectory ? detectProjectInfo(workingDirectory) : null;

  const baseUrl = options.baseUrl || (projectInfo ? projectInfo.baseUrl : 'http://localhost:3000');

  const pages = options.pages || [{ path: '/', label: 'home' }];

  ensureScreenshotDir();

  const targetPages = pages.slice(0, maxPages);

  log.info(`[ScreenshotService] Capturing ${targetPages.length} page(s) via Node.js worker`);

  // ページ数が多い場合はバッチ分割して実行（ワーカーの安定性確保）
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

  // バッチ実行: 5ページずつ順次処理
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
 * プロジェクトの全ページのスクリーンショットを撮影する（汎用版）
 * フロントエンドのルート構造を自動検出して全静的ページを撮影
 *
 * changedFiles が指定された場合は変更されたファイルに関連するページのみを撮影する
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
    // diffベース: 変更ファイルから影響のあるページのみを対象にする
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
    // 全ページモード
    targetPages = detectAllPages(workingDirectory);
    log.info(
      `[ScreenshotService] captureAll: detected ${targetPages.length} page(s): ${targetPages.map((p) => p.path).join(', ')}`,
    );
  }

  // maxPages のデフォルトを5に制限（不要なスクリーンショットを防止）
  return captureScreenshots({
    ...options,
    pages: targetPages,
    maxPages: options.maxPages || 5,
    workingDirectory,
  });
}

/**
 * AIエージェントの出力テキストからページパスを抽出する
 */
export function detectPagesFromAgentOutput(
  output: string,
  workingDirectory?: string,
): Array<{ path: string; label: string }> {
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();

  const projectInfo = workingDirectory ? detectProjectInfo(workingDirectory) : null;
  const port = projectInfo?.devPort || 3000;

  // localhost:PORT/path パターンを検出
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

  // src/app/xxx/page.tsx への言及パターン
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
 * structuredDiffとエージェント出力からスクリーンショットを撮影
 * 変更されたページのみを対象にし、不要なスクリーンショットを防止する
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

  // エージェントの出力テキストからも追加ページを検出
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
    // UI変更はあるがページが特定できない場合、トップページを撮影
    pages.push({ path: '/', label: 'home' });
  }

  // 最大ページ数を制限（デフォルト: 3）より厳格な制限
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
