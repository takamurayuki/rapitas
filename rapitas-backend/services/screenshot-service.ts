/**
 * Screenshot Service
 * Playwrightを使ってフロントエンド画面のスクリーンショットを撮影するサービス
 * 任意のプロジェクト（Next.js, Vite, CRA等）に対応
 *
 * Bun 環境では Playwright の pipe 接続がハングするため、
 * Node.js サブプロセスでスクリーンショットワーカーを実行する。
 */
import { join, basename } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const SCREENSHOT_DIR = join(process.cwd(), "uploads", "screenshots");

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
};

export type ProjectInfo = {
  type: "nextjs" | "vite" | "cra" | "nuxt" | "angular" | "unknown";
  frontendDir: string | null;
  devPort: number;
  baseUrl: string;
  srcDir: string | null;
  appDir: string | null;
  pagesDir: string | null;
};

/**
 * 作業ディレクトリからプロジェクト構造を自動検出する
 */
export function detectProjectInfo(workingDirectory: string): ProjectInfo {
  const result: ProjectInfo = {
    type: "unknown",
    frontendDir: null,
    devPort: 3000,
    baseUrl: "http://localhost:3000",
    srcDir: null,
    appDir: null,
    pagesDir: null,
  };

  // フロントエンドディレクトリの候補を探す
  const frontendDirCandidates = [
    "", // ルートにフロントエンドがある場合
    "frontend",
    "client",
    "web",
    "app",
  ];

  // プロジェクト名-frontend パターン（例: rapitas-frontend）
  const projectName = basename(workingDirectory);
  frontendDirCandidates.push(`${projectName}-frontend`);

  // 子ディレクトリを検索してフロントエンド候補を追加
  try {
    const entries = require("fs").readdirSync(workingDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith("-frontend")) {
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
    const packageJsonPath = join(dir, "package.json");

    if (!existsSync(packageJsonPath)) continue;

    let packageJson: any;
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    } catch {
      continue;
    }

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Next.js
    if (deps?.next) {
      result.type = "nextjs";
      result.frontendDir = dir;
      result.devPort = detectPort(dir, "nextjs") || 3000;

      // src/app (App Router) or src/pages (Pages Router) or app/ or pages/
      if (existsSync(join(dir, "src", "app"))) {
        result.srcDir = join(dir, "src");
        result.appDir = join(dir, "src", "app");
      } else if (existsSync(join(dir, "app"))) {
        result.appDir = join(dir, "app");
      }
      if (existsSync(join(dir, "src", "pages"))) {
        result.srcDir = result.srcDir || join(dir, "src");
        result.pagesDir = join(dir, "src", "pages");
      } else if (existsSync(join(dir, "pages"))) {
        result.pagesDir = join(dir, "pages");
      }
      break;
    }

    // Vite (React, Vue, Svelte)
    if (deps?.vite) {
      result.type = "vite";
      result.frontendDir = dir;
      result.devPort = detectPort(dir, "vite") || 5173;
      if (existsSync(join(dir, "src"))) {
        result.srcDir = join(dir, "src");
      }
      break;
    }

    // Create React App
    if (deps?.["react-scripts"]) {
      result.type = "cra";
      result.frontendDir = dir;
      result.devPort = detectPort(dir, "cra") || 3000;
      if (existsSync(join(dir, "src"))) {
        result.srcDir = join(dir, "src");
      }
      break;
    }

    // Nuxt
    if (deps?.nuxt) {
      result.type = "nuxt";
      result.frontendDir = dir;
      result.devPort = detectPort(dir, "nuxt") || 3000;
      if (existsSync(join(dir, "pages"))) {
        result.pagesDir = join(dir, "pages");
      }
      break;
    }

    // Angular
    if (deps?.["@angular/core"]) {
      result.type = "angular";
      result.frontendDir = dir;
      result.devPort = detectPort(dir, "angular") || 4200;
      if (existsSync(join(dir, "src"))) {
        result.srcDir = join(dir, "src");
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
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      const devScript = pkg.scripts?.dev || pkg.scripts?.start || "";
      const portMatch = devScript.match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
      if (portMatch) {
        return parseInt(portMatch[1] || portMatch[2] || portMatch[3]);
      }
    }

    // Next.js: next.config.js / next.config.ts
    if (projectType === "nextjs") {
      // .env ファイルからポート検出
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) {
        const env = readFileSync(envPath, "utf-8");
        const match = env.match(/PORT=(\d+)/);
        if (match) return parseInt(match[1]);
      }
    }

    // Vite: vite.config.ts / vite.config.js
    if (projectType === "vite") {
      for (const configFile of ["vite.config.ts", "vite.config.js"]) {
        const configPath = join(dir, configFile);
        if (existsSync(configPath)) {
          const content = readFileSync(configPath, "utf-8");
          const match = content.match(/port\s*:\s*(\d+)/);
          if (match) return parseInt(match[1]);
        }
      }
    }

    // Angular: angular.json
    if (projectType === "angular") {
      const angularJsonPath = join(dir, "angular.json");
      if (existsSync(angularJsonPath)) {
        const angularJson = JSON.parse(readFileSync(angularJsonPath, "utf-8"));
        const projects = angularJson.projects || {};
        for (const projName of Object.keys(projects)) {
          const port =
            projects[projName]?.architect?.serve?.options?.port;
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
 * 変更されたファイルにUI関連のファイルが含まれるかチェック（汎用版）
 */
export function hasUIChanges(
  changedFiles: string[],
  workingDirectory?: string,
): boolean {
  const projectInfo = workingDirectory
    ? detectProjectInfo(workingDirectory)
    : null;

  return changedFiles.some((file) => {
    const normalized = file.replace(/\\/g, "/");

    // UI関連の拡張子
    const isUIExtension =
      normalized.endsWith(".tsx") ||
      normalized.endsWith(".jsx") ||
      normalized.endsWith(".vue") ||
      normalized.endsWith(".svelte") ||
      normalized.endsWith(".css") ||
      normalized.endsWith(".scss") ||
      normalized.endsWith(".less") ||
      normalized.endsWith(".module.css") ||
      normalized.endsWith(".module.scss");

    if (!isUIExtension) return false;

    // プロジェクト固有の判定
    if (projectInfo && projectInfo.type !== "unknown") {
      const frontendDirName = projectInfo.frontendDir
        ? basename(projectInfo.frontendDir)
        : null;

      // フロントエンドディレクトリ内のファイルか
      if (frontendDirName && normalized.includes(`${frontendDirName}/`)) {
        return true;
      }
    }

    // 汎用的なUI関連パスパターン
    return (
      normalized.includes("src/app/") ||
      normalized.includes("src/pages/") ||
      normalized.includes("src/components/") ||
      normalized.includes("src/views/") ||
      normalized.includes("src/layouts/") ||
      normalized.includes("src/feature/") ||
      normalized.includes("src/features/") ||
      normalized.includes("app/") ||
      normalized.includes("pages/") ||
      normalized.includes("components/") ||
      normalized.includes("views/") ||
      normalized.includes("globals.css") ||
      normalized.includes("global.css") ||
      normalized.includes("index.css") ||
      normalized.includes("App.tsx") ||
      normalized.includes("App.jsx") ||
      normalized.includes("App.vue") ||
      normalized.includes("layout.tsx") ||
      normalized.includes("layout.jsx")
    );
  });
}

/**
 * 変更されたファイルから関連するページを推定する（汎用版）
 */
export function detectAffectedPages(
  changedFiles: string[],
  workingDirectory?: string,
): Array<{ path: string; label: string }> {
  const pages: Array<{ path: string; label: string }> = [];
  const addedPaths = new Set<string>();

  const projectInfo = workingDirectory
    ? detectProjectInfo(workingDirectory)
    : null;

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, "/");

    // UI関連の拡張子チェック
    const isUIFile =
      normalized.endsWith(".tsx") ||
      normalized.endsWith(".jsx") ||
      normalized.endsWith(".vue") ||
      normalized.endsWith(".svelte") ||
      normalized.endsWith(".css") ||
      normalized.endsWith(".scss");

    if (!isUIFile) continue;

    // Next.js App Router: src/app/xxx/page.tsx → /xxx
    const appRouterMatch = normalized.match(
      /(?:[\w-]+\/)?src\/app\/(.+?)\/(?:page\.[tj]sx?|.*Client\.[tj]sx?|layout\.[tj]sx?)/,
    );
    if (appRouterMatch) {
      const routePath = `/${appRouterMatch[1]}`;
      if (!addedPaths.has(routePath)) {
        addedPaths.add(routePath);
        pages.push({
          path: routePath,
          label: routePath.split("/").pop() || routePath,
        });
      }
      continue;
    }

    // Next.js App Router (no src): app/xxx/page.tsx → /xxx
    const appDirMatch = normalized.match(
      /app\/(.+?)\/(?:page\.[tj]sx?|.*Client\.[tj]sx?|layout\.[tj]sx?)/,
    );
    if (appDirMatch && !normalized.includes("src/app/")) {
      const routePath = `/${appDirMatch[1]}`;
      if (!addedPaths.has(routePath)) {
        addedPaths.add(routePath);
        pages.push({
          path: routePath,
          label: routePath.split("/").pop() || routePath,
        });
      }
      continue;
    }

    // Next.js Pages Router / Nuxt: pages/xxx.tsx → /xxx
    const pagesMatch = normalized.match(
      /pages\/(.+?)\.[tj]sx?$|pages\/(.+?)\.vue$/,
    );
    if (pagesMatch) {
      const pageName = (pagesMatch[1] || pagesMatch[2]).replace(/\/index$/, "");
      if (pageName === "index" || pageName === "_app" || pageName === "_document") {
        if (!addedPaths.has("/")) {
          addedPaths.add("/");
          pages.push({ path: "/", label: "home" });
        }
      } else if (!pageName.startsWith("_")) {
        const routePath = `/${pageName}`;
        if (!addedPaths.has(routePath)) {
          addedPaths.add(routePath);
          pages.push({
            path: routePath,
            label: routePath.split("/").pop() || routePath,
          });
        }
      }
      continue;
    }

    // Vue Router / React Router: views/xxx.vue or views/xxx.tsx
    const viewsMatch = normalized.match(
      /views\/(.+?)\.[tj]sx?$|views\/(.+?)\.vue$/,
    );
    if (viewsMatch) {
      const viewName = (viewsMatch[1] || viewsMatch[2]).replace(/\/index$/, "");
      const routePath = `/${viewName.toLowerCase()}`;
      if (!addedPaths.has(routePath)) {
        addedPaths.add(routePath);
        pages.push({
          path: routePath,
          label: viewName.split("/").pop() || viewName,
        });
      }
      continue;
    }

    // 共通コンポーネントの変更 → トップページを撮影
    if (
      normalized.includes("/components/") &&
      !normalized.includes("/app/") &&
      !normalized.includes("/pages/")
    ) {
      if (!addedPaths.has("/")) {
        addedPaths.add("/");
        pages.push({ path: "/", label: "home" });
      }
    }

    // グローバルCSS / レイアウトの変更 → トップページ
    if (
      normalized.includes("globals.css") ||
      normalized.includes("global.css") ||
      normalized.includes("index.css") ||
      (normalized.includes("layout.") && !normalized.includes("/app/"))
    ) {
      if (!addedPaths.has("/")) {
        addedPaths.add("/");
        pages.push({ path: "/", label: "home" });
      }
    }
  }

  return pages;
}

/**
 * Node.js サブプロセスでスクリーンショットワーカーを実行する
 *
 * Bun 環境では Playwright の pipe 接続（--remote-debugging-pipe）が
 * ハングするため、Node.js サブプロセスとして実行する。
 * 参考: https://github.com/oven-sh/bun/issues/23826
 */
function runScreenshotWorker(
  workerInput: Record<string, unknown>,
): Promise<ScreenshotResult[]> {
  return new Promise((resolve, reject) => {
    const workerPath = join(import.meta.dir, "screenshot-worker.cjs");
    const child = spawn("node", [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      // ワーカーのログをそのまま出力
      process.stderr.write(msg);
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        console.error(`[ScreenshotService] Worker exited with code ${code}`);
      }

      try {
        const results = JSON.parse(stdout || "[]");
        resolve(results);
      } catch {
        console.error("[ScreenshotService] Failed to parse worker output:", stdout);
        resolve([]);
      }
    });

    child.on("error", (err: Error) => {
      console.error("[ScreenshotService] Failed to spawn worker:", err.message);
      resolve([]);
    });

    // stdin にオプションを書き込んで閉じる
    child.stdin.write(JSON.stringify(workerInput));
    child.stdin.end();

    // 全体のタイムアウト（3分）
    setTimeout(() => {
      try {
        child.kill();
      } catch {}
      console.error("[ScreenshotService] Worker timed out after 180s");
      resolve([]);
    }, 180000);
  });
}

/**
 * Playwrightを使ってスクリーンショットを撮影する
 * Bun 互換性のため Node.js サブプロセスで実行
 */
export async function captureScreenshots(
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult[]> {
  const {
    workingDirectory,
    viewport = { width: 1280, height: 720 },
    waitMs = 5000,
    darkMode = false,
  } = options;

  // workingDirectory からプロジェクト情報を自動検出し、baseUrl を決定
  const projectInfo = workingDirectory
    ? detectProjectInfo(workingDirectory)
    : null;

  const baseUrl =
    options.baseUrl ||
    (projectInfo ? projectInfo.baseUrl : "http://localhost:3000");

  const pages = options.pages || [{ path: "/", label: "home" }];

  ensureScreenshotDir();

  const targetPages = pages.slice(0, 5);

  console.log(
    `[ScreenshotService] Capturing ${targetPages.length} page(s) via Node.js worker`,
  );

  return runScreenshotWorker({
    baseUrl,
    pages: targetPages,
    viewport,
    waitMs,
    darkMode,
    screenshotDir: SCREENSHOT_DIR,
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

  const projectInfo = workingDirectory
    ? detectProjectInfo(workingDirectory)
    : null;
  const port = projectInfo?.devPort || 3000;

  // localhost:PORT/path パターンを検出
  const urlPattern = new RegExp(
    `(?:https?://)?localhost:${port}(/[\\w\\-/]*)`,
    "g",
  );
  let match;
  while ((match = urlPattern.exec(output)) !== null) {
    const pagePath = match[1] || "/";
    if (!addedPaths.has(pagePath)) {
      addedPaths.add(pagePath);
      pages.push({
        path: pagePath,
        label: pagePath === "/" ? "home" : pagePath.split("/").pop() || pagePath,
      });
    }
  }

  // src/app/xxx/page.tsx への言及パターン
  const appRouterMentionPattern =
    /src\/app\/([^\s/]+(?:\/[^\s/]+)*)\/page\.[tj]sx?/g;
  while ((match = appRouterMentionPattern.exec(output)) !== null) {
    const pagePath = `/${match[1]}`;
    if (!addedPaths.has(pagePath)) {
      addedPaths.add(pagePath);
      pages.push({
        path: pagePath,
        label: pagePath.split("/").pop() || pagePath,
      });
    }
  }

  return pages;
}

/**
 * structuredDiffとエージェント出力からスクリーンショットを撮影
 */
export async function captureScreenshotsForDiff(
  structuredDiff: Array<{ filename: string }>,
  options?: Partial<ScreenshotOptions> & { agentOutput?: string },
): Promise<ScreenshotResult[]> {
  const changedFiles = structuredDiff.map((d) => d.filename);
  const workingDirectory = options?.workingDirectory;

  if (!hasUIChanges(changedFiles, workingDirectory)) {
    console.log(
      "[ScreenshotService] No UI changes detected, skipping screenshots.",
    );
    return [];
  }

  const pages = detectAffectedPages(changedFiles, workingDirectory);

  // エージェントの出力テキストからも追加ページを検出
  if (options?.agentOutput) {
    const agentPages = detectPagesFromAgentOutput(
      options.agentOutput,
      workingDirectory,
    );
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
    pages.push({ path: "/", label: "home" });
  }

  console.log(
    `[ScreenshotService] Target pages: ${pages.map((p) => p.path).join(", ")}`,
  );

  return captureScreenshots({
    ...options,
    pages,
    workingDirectory,
  });
}
