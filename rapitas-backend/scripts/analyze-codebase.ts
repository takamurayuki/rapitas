/**
 * Rapitas Codebase Analysis Script
 *
 * Usage: bun run rapitas-backend/scripts/analyze-codebase.ts
 * Output: analysis-result.json + analysis-report.md
 *
 * No external dependencies - uses Node.js built-in APIs only.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "fs";
import { join, extname, relative, basename, dirname } from "path";
import { createLogger } from '../config/logger';

const log = createLogger('analyze-codebase');

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const BACKEND_ROOT = join(PROJECT_ROOT, "rapitas-backend");
const FRONTEND_ROOT = join(PROJECT_ROOT, "rapitas-frontend");
const DESKTOP_ROOT = join(PROJECT_ROOT, "rapitas-desktop");

const EXCLUDED_DIRS = new Set([
  "node_modules", ".next", ".next-tauri", "dist", ".git", "target", "build",
  "uploads", "logs", ".claude", ".storybook", "out", ".turbo",
  "coverage", ".prisma", ".dart_tool", "flutter", "rapitas-manager",
  "gen", "src-tauri", ".turbopack",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".css", ".prisma", ".json", ".md",
  ".html", ".yaml", ".yml", ".toml", ".rs", ".sql",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileInfo {
  path: string;
  relativePath: string;
  ext: string;
  lines: number;
  size: number;
  content: string;
}

interface ExtensionStats {
  extension: string;
  fileCount: number;
  totalLines: number;
  totalSize: number;
  avgLines: number;
}

interface Endpoint {
  method: string;
  path: string;
  file: string;
}

interface PrismaModel {
  name: string;
  fieldCount: number;
  relations: string[];
}

interface FeatureArea {
  name: string;
  routes: number;
  services: number;
  components: number;
  hooks: number;
  models: number;
  tests: number;
  score: number;
}

interface AnalysisResult {
  metadata: {
    generatedAt: string;
    executionTimeMs: number;
    projectRoot: string;
  };
  codeMetrics: {
    byExtension: ExtensionStats[];
    byDirectory: Record<string, { files: number; lines: number; size: number }>;
    largestFiles: { path: string; lines: number; size: number }[];
    totalFiles: number;
    totalLines: number;
    totalSize: number;
  };
  architecture: {
    backend: {
      routeFiles: number;
      endpoints: Endpoint[];
      services: string[];
    };
    prisma: {
      modelCount: number;
      models: PrismaModel[];
      totalRelations: number;
    };
    frontend: {
      components: { category: string; count: number; files: string[] }[];
      hooks: string[];
      stores: string[];
      pages: string[];
    };
  };
  quality: {
    testFiles: number;
    sourceFiles: number;
    testRatio: number;
    anyUsage: number;
    todoCount: number;
    fixmeCount: number;
    hackCount: number;
    consoleLogCount: number;
    tryCatchCount: number;
  };
  aiAgent: {
    providers: string[];
    agentTypes: string[];
    agentRoutes: string[];
    agentServices: string[];
  };
  dependencies: {
    backend: { total: number; production: number; dev: number };
    frontend: { total: number; production: number; dev: number };
  };
  featureCompleteness: FeatureArea[];
  scoring: {
    qualityScore: number;
    featureCoverageScore: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  };
}

// ─── File Walking ─────────────────────────────────────────────────────────────

function walkDir(dir: string, allFiles: FileInfo[] = []): FileInfo[] {
  if (!existsSync(dir)) return allFiles;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return allFiles;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, allFiles);
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      // Skip very large files (likely generated/bundled)
      if (stat.size > 500_000) continue;

      let content = "";
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n").length;
      allFiles.push({
        path: fullPath,
        relativePath: relative(PROJECT_ROOT, fullPath),
        ext,
        lines,
        size: stat.size,
        content,
      });
    }
  }

  return allFiles;
}

// ─── Code Metrics ─────────────────────────────────────────────────────────────

function collectCodeMetrics(files: FileInfo[]): AnalysisResult["codeMetrics"] {
  // By extension
  const extMap = new Map<string, { count: number; lines: number; size: number }>();
  for (const f of files) {
    const entry = extMap.get(f.ext) || { count: 0, lines: 0, size: 0 };
    entry.count++;
    entry.lines += f.lines;
    entry.size += f.size;
    extMap.set(f.ext, entry);
  }

  const byExtension: ExtensionStats[] = [...extMap.entries()]
    .map(([ext, data]) => ({
      extension: ext,
      fileCount: data.count,
      totalLines: data.lines,
      totalSize: data.size,
      avgLines: Math.round(data.lines / data.count),
    }))
    .sort((a, b) => b.totalLines - a.totalLines);

  // By directory (top-level project dirs)
  const byDirectory: Record<string, { files: number; lines: number; size: number }> = {};
  for (const f of files) {
    const parts = f.relativePath.split(/[\\/]/);
    const topDir = parts[0] || "root";
    if (!byDirectory[topDir]) byDirectory[topDir] = { files: 0, lines: 0, size: 0 };
    byDirectory[topDir].files++;
    byDirectory[topDir].lines += f.lines;
    byDirectory[topDir].size += f.size;
  }

  // Largest files
  const largestFiles = [...files]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 20)
    .map((f) => ({ path: f.relativePath, lines: f.lines, size: f.size }));

  return {
    byExtension,
    byDirectory,
    largestFiles,
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lines, 0),
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
  };
}

// ─── Architecture Metrics ─────────────────────────────────────────────────────

function collectArchitectureMetrics(files: FileInfo[]): AnalysisResult["architecture"] {
  // Backend routes & endpoints
  const routeFiles = files.filter(
    (f) => f.relativePath.startsWith("rapitas-backend") && f.relativePath.includes("routes") && f.ext === ".ts"
  );

  const endpoints: Endpoint[] = [];
  for (const rf of routeFiles) {
    // Detect Elysia prefix
    const prefixMatch = rf.content.match(/\.group\s*\(\s*["'`]([^"'`]+)["'`]/);
    const prefix2 = rf.content.match(/prefix\s*[:=]\s*["'`]([^"'`]+)["'`]/);
    const routePrefix = prefixMatch?.[1] || prefix2?.[1] || "";

    // Detect HTTP methods: .get(), .post(), .put(), .patch(), .delete()
    const methodRegex = /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    let match;
    while ((match = methodRegex.exec(rf.content)) !== null) {
      endpoints.push({
        method: match[1].toUpperCase(),
        path: routePrefix ? `${routePrefix}${match[2]}` : match[2],
        file: rf.relativePath,
      });
    }
  }

  // Backend services
  const serviceFiles = files.filter(
    (f) => f.relativePath.startsWith("rapitas-backend") && f.relativePath.includes("services") && f.ext === ".ts"
  );
  const services = serviceFiles.map((f) => f.relativePath);

  // Prisma models
  const prismaFile = files.find((f) => f.relativePath.endsWith("schema.prisma"));
  const models: PrismaModel[] = [];
  if (prismaFile) {
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
    let mMatch;
    while ((mMatch = modelRegex.exec(prismaFile.content)) !== null) {
      const modelName = mMatch[1];
      const body = mMatch[2];
      const fieldLines = body.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("@@"));
      const relations = [...body.matchAll(/@relation/g)].length;
      const relationTargets: string[] = [];
      const relRegex = /@relation\s*\(\s*(?:name:\s*["']([^"']+)["'],?\s*)?fields:\s*\[([^\]]+)\]/g;
      let rMatch;
      while ((rMatch = relRegex.exec(body)) !== null) {
        relationTargets.push(rMatch[1] || rMatch[2]);
      }
      models.push({
        name: modelName,
        fieldCount: fieldLines.length,
        relations: relationTargets,
      });
    }
  }

  // Frontend components
  const componentCategories = new Map<string, string[]>();
  const frontendComponents = files.filter(
    (f) => f.relativePath.startsWith("rapitas-frontend") && f.ext === ".tsx"
  );
  for (const f of frontendComponents) {
    const parts = f.relativePath.split(/[\\/]/);
    // Determine category from path
    let category = "other";
    if (parts.includes("feature")) {
      const idx = parts.indexOf("feature");
      category = parts[idx + 1] || "feature";
    } else if (parts.includes("components")) {
      category = "shared-components";
    } else if (parts.includes("app")) {
      category = "pages";
    }
    const list = componentCategories.get(category) || [];
    list.push(f.relativePath);
    componentCategories.set(category, list);
  }

  const components = [...componentCategories.entries()]
    .map(([cat, fileList]) => ({ category: cat, count: fileList.length, files: fileList }))
    .sort((a, b) => b.count - a.count);

  // Hooks
  const hooks = files
    .filter((f) => f.relativePath.startsWith("rapitas-frontend") && f.relativePath.includes("hooks"))
    .map((f) => basename(f.relativePath, f.ext));

  // Stores
  const stores = files
    .filter((f) => f.relativePath.startsWith("rapitas-frontend") && f.relativePath.includes("stores"))
    .map((f) => basename(f.relativePath, f.ext));

  // Pages (app directory routes)
  const pages = files
    .filter(
      (f) =>
        f.relativePath.startsWith("rapitas-frontend") &&
        f.relativePath.includes("app") &&
        basename(f.relativePath) === "page.tsx"
    )
    .map((f) => {
      const parts = f.relativePath.split(/[\\/]/);
      const appIdx = parts.indexOf("app");
      return "/" + parts.slice(appIdx + 1, -1).join("/");
    });

  return {
    backend: {
      routeFiles: routeFiles.length,
      endpoints,
      services,
    },
    prisma: {
      modelCount: models.length,
      models,
      totalRelations: models.reduce((sum, m) => sum + m.relations.length, 0),
    },
    frontend: {
      components,
      hooks,
      stores,
      pages,
    },
  };
}

// ─── Quality Metrics ──────────────────────────────────────────────────────────

function collectQualityMetrics(files: FileInfo[]): AnalysisResult["quality"] {
  const tsFiles = files.filter((f) => f.ext === ".ts" || f.ext === ".tsx");
  const testFiles = files.filter(
    (f) => f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) || f.relativePath.includes("__tests__")
  );
  const sourceFiles = tsFiles.filter(
    (f) => !f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) && !f.relativePath.includes("__tests__")
  );

  let anyUsage = 0;
  let todoCount = 0;
  let fixmeCount = 0;
  let hackCount = 0;
  let consoleLogCount = 0;
  let tryCatchCount = 0;

  for (const f of tsFiles) {
    const lines = f.content.split("\n");
    for (const line of lines) {
      // any type usage (exclude comments)
      if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        if (/:\s*any\b/.test(line) || /as\s+any\b/.test(line) || /<any>/.test(line)) {
          anyUsage++;
        }
      }
      if (/\bTODO\b/i.test(line)) todoCount++;
      if (/\bFIXME\b/i.test(line)) fixmeCount++;
      if (/\bHACK\b/i.test(line)) hackCount++;
      if (/console\.log\s*\(/.test(line)) consoleLogCount++;
      if (/\btry\s*\{/.test(line)) tryCatchCount++;
    }
  }

  const testRatio = sourceFiles.length > 0 ? Math.round((testFiles.length / sourceFiles.length) * 100) / 100 : 0;

  return {
    testFiles: testFiles.length,
    sourceFiles: sourceFiles.length,
    testRatio,
    anyUsage,
    todoCount,
    fixmeCount,
    hackCount,
    consoleLogCount,
    tryCatchCount,
  };
}

// ─── AI/Agent Metrics ─────────────────────────────────────────────────────────

function collectAIAgentMetrics(files: FileInfo[]): AnalysisResult["aiAgent"] {
  const providers: Set<string> = new Set();
  const agentTypes: Set<string> = new Set();

  for (const f of files) {
    if (!f.relativePath.startsWith("rapitas-backend")) continue;
    if (f.ext !== ".ts") continue;

    // Detect AI providers
    if (f.content.includes("@anthropic-ai/sdk") || f.content.includes("Anthropic")) providers.add("Anthropic (Claude)");
    if (f.content.includes("openai") || f.content.includes("OpenAI")) providers.add("OpenAI");
    if (f.content.includes("@google/generative-ai") || f.content.includes("GoogleGenerativeAI")) providers.add("Google (Gemini)");

    // Detect agent types from agent-related files
    if (f.relativePath.includes("agent")) {
      const typeMatches = f.content.matchAll(/agentType['":\s]*["'`](\w+)["'`]/g);
      for (const m of typeMatches) {
        agentTypes.add(m[1]);
      }
      // Also check type definitions
      const enumMatches = f.content.matchAll(/["'`](code_review|implementation|bug_fix|refactor|test_generation|analysis|planning|execution|auto_run|manual)["'`]/g);
      for (const m of enumMatches) {
        agentTypes.add(m[1]);
      }
    }
  }

  const agentRoutes = files
    .filter((f) => f.relativePath.startsWith("rapitas-backend") && f.relativePath.includes("route") && f.relativePath.includes("agent"))
    .map((f) => f.relativePath);

  const agentServices = files
    .filter((f) => f.relativePath.startsWith("rapitas-backend") && f.relativePath.includes("service") && f.relativePath.includes("agent"))
    .map((f) => f.relativePath);

  return {
    providers: [...providers],
    agentTypes: [...agentTypes],
    agentRoutes,
    agentServices,
  };
}

// ─── Dependency Metrics ───────────────────────────────────────────────────────

function collectDependencyMetrics(): AnalysisResult["dependencies"] {
  const readPkg = (dir: string) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      const prod = Object.keys(pkg.dependencies || {}).length;
      const dev = Object.keys(pkg.devDependencies || {}).length;
      return { total: prod + dev, production: prod, dev };
    } catch {
      return { total: 0, production: 0, dev: 0 };
    }
  };

  return {
    backend: readPkg(BACKEND_ROOT),
    frontend: readPkg(FRONTEND_ROOT),
  };
}

// ─── Feature Completeness ─────────────────────────────────────────────────────

function collectFeatureCompleteness(
  files: FileInfo[],
  arch: AnalysisResult["architecture"]
): FeatureArea[] {
  const areas: { name: string; keywords: string[] }[] = [
    { name: "タスク管理", keywords: ["task", "tasks"] },
    { name: "ポモドーロ/時間管理", keywords: ["pomodoro", "time-entr", "timer"] },
    { name: "AIエージェント", keywords: ["agent", "ai-agent", "ai-chat", "claude"] },
    { name: "ワークフロー", keywords: ["workflow"] },
    { name: "GitHub連携", keywords: ["github"] },
    { name: "認証", keywords: ["auth", "login", "session"] },
    { name: "通知", keywords: ["notification"] },
    { name: "検索", keywords: ["search"] },
    { name: "カレンダー/スケジュール", keywords: ["calendar", "schedule", "daily-schedule"] },
    { name: "学習/習慣", keywords: ["habit", "study", "learning", "flashcard", "exam"] },
    { name: "分析/レポート", keywords: ["report", "statistic", "achievement", "analytics"] },
  ];

  return areas.map((area) => {
    const matchesKeyword = (path: string) =>
      area.keywords.some((kw) => path.toLowerCase().includes(kw));

    const routes = files.filter(
      (f) => f.relativePath.startsWith("rapitas-backend") && f.relativePath.includes("routes") && matchesKeyword(f.relativePath)
    ).length;

    const services = files.filter(
      (f) => f.relativePath.startsWith("rapitas-backend") && f.relativePath.includes("services") && matchesKeyword(f.relativePath)
    ).length;

    const components = files.filter(
      (f) => f.relativePath.startsWith("rapitas-frontend") && f.ext === ".tsx" && matchesKeyword(f.relativePath)
    ).length;

    const hooks = files.filter(
      (f) => f.relativePath.startsWith("rapitas-frontend") && f.relativePath.includes("hooks") && matchesKeyword(f.relativePath)
    ).length;

    const models = arch.prisma.models.filter((m) =>
      area.keywords.some((kw) => m.name.toLowerCase().includes(kw))
    ).length;

    const tests = files.filter(
      (f) => f.relativePath.match(/\.(test|spec)\./) && matchesKeyword(f.relativePath)
    ).length;

    // Score: weighted presence check (routes 25, services 20, components 25, hooks 10, models 15, tests 5)
    let score = 0;
    if (routes > 0) score += 25;
    if (services > 0) score += 20;
    if (components > 0) score += 25;
    if (hooks > 0) score += 10;
    if (models > 0) score += 15;
    if (tests > 0) score += 5;

    return { name: area.name, routes, services, components, hooks, models, tests, score };
  });
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function computeScoring(
  quality: AnalysisResult["quality"],
  features: FeatureArea[],
  arch: AnalysisResult["architecture"],
  codeMetrics: AnalysisResult["codeMetrics"]
): AnalysisResult["scoring"] {
  // Quality Score (0-100)
  let qualityScore = 50; // base

  // Test ratio penalty/bonus
  if (quality.testRatio >= 0.5) qualityScore += 20;
  else if (quality.testRatio >= 0.2) qualityScore += 10;
  else if (quality.testRatio >= 0.05) qualityScore += 5;
  else qualityScore -= 10;

  // any usage penalty
  const anyPer1000 = (quality.anyUsage / (codeMetrics.totalLines / 1000));
  if (anyPer1000 < 1) qualityScore += 10;
  else if (anyPer1000 < 5) qualityScore += 5;
  else if (anyPer1000 > 20) qualityScore -= 15;
  else if (anyPer1000 > 10) qualityScore -= 10;

  // console.log penalty
  if (quality.consoleLogCount < 10) qualityScore += 5;
  else if (quality.consoleLogCount > 100) qualityScore -= 10;
  else if (quality.consoleLogCount > 50) qualityScore -= 5;

  // Architecture bonus: endpoint richness
  if (arch.backend.endpoints.length > 100) qualityScore += 10;
  else if (arch.backend.endpoints.length > 50) qualityScore += 5;

  // Prisma model richness
  if (arch.prisma.modelCount > 30) qualityScore += 5;
  else if (arch.prisma.modelCount > 15) qualityScore += 3;

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  // Feature Coverage Score
  const featureCoverageScore = Math.round(
    features.reduce((sum, f) => sum + f.score, 0) / features.length
  );

  // Strengths, weaknesses, suggestions
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];

  if (arch.backend.endpoints.length > 80) strengths.push(`豊富なAPIエンドポイント（${arch.backend.endpoints.length}件）`);
  if (arch.prisma.modelCount > 30) strengths.push(`充実したデータモデル（${arch.prisma.modelCount}モデル）`);
  if (arch.frontend.pages.length > 15) strengths.push(`多彩なフロントエンドページ（${arch.frontend.pages.length}ルート）`);
  if (arch.frontend.hooks.length > 10) strengths.push(`再利用可能なカスタムフック（${arch.frontend.hooks.length}個）`);

  const strongFeatures = features.filter((f) => f.score >= 75);
  if (strongFeatures.length > 0) {
    strengths.push(`高カバレッジ機能エリア: ${strongFeatures.map((f) => f.name).join(", ")}`);
  }

  if (quality.testRatio < 0.1) weaknesses.push(`テストカバレッジが低い（テスト比率: ${quality.testRatio}）`);
  if (quality.anyUsage > 50) weaknesses.push(`any型の使用が多い（${quality.anyUsage}箇所）`);
  if (quality.consoleLogCount > 50) weaknesses.push(`console.logが多い（${quality.consoleLogCount}箇所）`);
  if (quality.todoCount > 20) weaknesses.push(`未解決のTODOが多い（${quality.todoCount}件）`);

  const weakFeatures = features.filter((f) => f.score < 50);
  if (weakFeatures.length > 0) {
    weaknesses.push(`低カバレッジ機能エリア: ${weakFeatures.map((f) => f.name).join(", ")}`);
  }

  if (quality.testRatio < 0.2) suggestions.push("テストの拡充（特にバックエンドのユニットテスト）");
  if (quality.anyUsage > 30) suggestions.push("any型を具体的な型に置き換える型安全性の向上");
  if (quality.consoleLogCount > 30) suggestions.push("console.logをロガーライブラリに置き換え");
  if (weakFeatures.length > 0) {
    suggestions.push(`機能拡充の優先エリア: ${weakFeatures.map((f) => f.name).join(", ")}`);
  }

  return { qualityScore, featureCoverageScore, strengths, weaknesses, suggestions };
}

// ─── Markdown Report ──────────────────────────────────────────────────────────

function generateMarkdownReport(result: AnalysisResult): string {
  const { metadata, codeMetrics, architecture, quality, aiAgent, dependencies, featureCompleteness, scoring } = result;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  let md = `# Rapitas Codebase Analysis Report

> Generated: ${metadata.generatedAt}
> Execution time: ${metadata.executionTimeMs}ms
> Project root: \`${metadata.projectRoot}\`

---

## 1. コードメトリクス

### サマリ
| 項目 | 値 |
|------|-----|
| 総ファイル数 | ${codeMetrics.totalFiles} |
| 総コード行数 | ${codeMetrics.totalLines.toLocaleString()} |
| 総サイズ | ${formatBytes(codeMetrics.totalSize)} |

### 拡張子別
| 拡張子 | ファイル数 | 行数 | サイズ | 平均行数 |
|--------|-----------|------|--------|----------|
${codeMetrics.byExtension.map((e) => `| ${e.extension} | ${e.fileCount} | ${e.totalLines.toLocaleString()} | ${formatBytes(e.totalSize)} | ${e.avgLines} |`).join("\n")}

### ディレクトリ別
| ディレクトリ | ファイル数 | 行数 | サイズ |
|-------------|-----------|------|--------|
${Object.entries(codeMetrics.byDirectory)
  .sort(([, a], [, b]) => b.lines - a.lines)
  .map(([dir, d]) => `| ${dir} | ${d.files} | ${d.lines.toLocaleString()} | ${formatBytes(d.size)} |`)
  .join("\n")}

### 最大ファイル Top20
| # | ファイル | 行数 | サイズ |
|---|---------|------|--------|
${codeMetrics.largestFiles.map((f, i) => `| ${i + 1} | \`${f.path}\` | ${f.lines.toLocaleString()} | ${formatBytes(f.size)} |`).join("\n")}

---

## 2. アーキテクチャ

### Backend
- **ルートファイル数**: ${architecture.backend.routeFiles}
- **検出エンドポイント数**: ${architecture.backend.endpoints.length}
- **サービス数**: ${architecture.backend.services.length}

<details>
<summary>エンドポイント一覧 (${architecture.backend.endpoints.length}件)</summary>

| メソッド | パス | ファイル |
|----------|------|---------|
${architecture.backend.endpoints.map((e) => `| ${e.method} | \`${e.path}\` | \`${e.file}\` |`).join("\n")}

</details>

<details>
<summary>サービス一覧 (${architecture.backend.services.length}件)</summary>

${architecture.backend.services.map((s) => `- \`${s}\``).join("\n")}

</details>

### Prisma モデル
- **モデル数**: ${architecture.prisma.modelCount}
- **総リレーション数**: ${architecture.prisma.totalRelations}

<details>
<summary>モデル一覧</summary>

| モデル名 | フィールド数 | リレーション数 |
|----------|------------|---------------|
${architecture.prisma.models.map((m) => `| ${m.name} | ${m.fieldCount} | ${m.relations.length} |`).join("\n")}

</details>

### Frontend
- **コンポーネント (カテゴリ別)**:
${architecture.frontend.components.map((c) => `  - **${c.category}**: ${c.count}ファイル`).join("\n")}
- **カスタムフック数**: ${architecture.frontend.hooks.length}
- **ストア数**: ${architecture.frontend.stores.length}
- **ページルート数**: ${architecture.frontend.pages.length}

<details>
<summary>ページルート一覧</summary>

${architecture.frontend.pages.map((p) => `- \`${p}\``).join("\n")}

</details>

---

## 3. 品質指標

| 指標 | 値 |
|------|-----|
| テストファイル数 | ${quality.testFiles} |
| ソースファイル数 | ${quality.sourceFiles} |
| テスト比率 | ${quality.testRatio} (${(quality.testRatio * 100).toFixed(1)}%) |
| \`any\`型使用数 | ${quality.anyUsage} |
| TODO コメント | ${quality.todoCount} |
| FIXME コメント | ${quality.fixmeCount} |
| HACK コメント | ${quality.hackCount} |
| console.log 使用数 | ${quality.consoleLogCount} |
| try/catch ブロック数 | ${quality.tryCatchCount} |

---

## 4. AI/エージェントシステム

| 項目 | 値 |
|------|-----|
| AIプロバイダー | ${aiAgent.providers.join(", ") || "なし"} |
| エージェントタイプ | ${aiAgent.agentTypes.length > 0 ? aiAgent.agentTypes.join(", ") : "（動的定義）"} |
| エージェントルート数 | ${aiAgent.agentRoutes.length} |
| エージェントサービス数 | ${aiAgent.agentServices.length} |

<details>
<summary>エージェント関連ファイル</summary>

**ルート:**
${aiAgent.agentRoutes.map((r) => `- \`${r}\``).join("\n")}

**サービス:**
${aiAgent.agentServices.map((s) => `- \`${s}\``).join("\n")}

</details>

---

## 5. 依存関係

| パッケージ | 本番 | 開発 | 合計 |
|-----------|------|------|------|
| Backend | ${dependencies.backend.production} | ${dependencies.backend.dev} | ${dependencies.backend.total} |
| Frontend | ${dependencies.frontend.production} | ${dependencies.frontend.dev} | ${dependencies.frontend.total} |
| **合計** | **${dependencies.backend.production + dependencies.frontend.production}** | **${dependencies.backend.dev + dependencies.frontend.dev}** | **${dependencies.backend.total + dependencies.frontend.total}** |

---

## 6. 機能網羅性

| エリア | ルート | サービス | コンポーネント | フック | モデル | テスト | スコア |
|--------|--------|----------|--------------|--------|--------|--------|--------|
${featureCompleteness.map((f) => `| ${f.name} | ${f.routes} | ${f.services} | ${f.components} | ${f.hooks} | ${f.models} | ${f.tests} | **${f.score}/100** |`).join("\n")}

**平均機能カバレッジスコア: ${scoring.featureCoverageScore}/100**

---

## 7. 総合評価

### スコア
| 指標 | スコア |
|------|--------|
| 品質スコア | **${scoring.qualityScore}/100** |
| 機能カバレッジスコア | **${scoring.featureCoverageScore}/100** |

### 強み
${scoring.strengths.length > 0 ? scoring.strengths.map((s) => `- ${s}`).join("\n") : "- 特記事項なし"}

### 弱み
${scoring.weaknesses.length > 0 ? scoring.weaknesses.map((w) => `- ${w}`).join("\n") : "- 特記事項なし"}

### 改善提案
${scoring.suggestions.length > 0 ? scoring.suggestions.map((s) => `- ${s}`).join("\n") : "- 特記事項なし"}

---

## 8. AI評価用プロンプト

以下のプロンプトと共に \`analysis-result.json\` をAIに投入することで、詳細な評価を得られます。

\`\`\`
以下はRapitasプロジェクトのコードベース自動分析結果です。
このデータを基に、以下の観点で評価・提案を行ってください：

1. アーキテクチャの成熟度（1-10）と根拠
2. コード品質の評価（1-10）と具体的な改善箇所
3. 機能完成度の評価（1-10）と不足している機能
4. 技術的負債の特定と優先順位付き解消計画
5. スケーラビリティの評価と改善提案
6. セキュリティリスクの特定
7. 次の開発スプリントで取り組むべきTop5タスク

[analysis-result.json の内容をここに貼り付け]
\`\`\`
`;

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  log.info("Rapitas Codebase Analysis - Starting...");
  log.info(`Project root: ${PROJECT_ROOT}`);

  // Walk all files
  log.info("Scanning files...");
  const files = walkDir(PROJECT_ROOT);
  log.info(`Found ${files.length} files`);

  // Collect all metrics
  log.info("Collecting code metrics...");
  const codeMetrics = collectCodeMetrics(files);

  log.info("Collecting architecture metrics...");
  const architecture = collectArchitectureMetrics(files);

  log.info("Collecting quality metrics...");
  const quality = collectQualityMetrics(files);

  log.info("Collecting AI/agent metrics...");
  const aiAgent = collectAIAgentMetrics(files);

  log.info("Collecting dependency metrics...");
  const deps = collectDependencyMetrics();

  log.info("Collecting feature completeness...");
  const featureCompleteness = collectFeatureCompleteness(files, architecture);

  log.info("Computing scores...");
  const scoring = computeScoring(quality, featureCompleteness, architecture, codeMetrics);

  const executionTimeMs = Date.now() - startTime;

  const result: AnalysisResult = {
    metadata: {
      generatedAt: new Date().toISOString(),
      executionTimeMs,
      projectRoot: PROJECT_ROOT,
    },
    codeMetrics,
    architecture,
    quality,
    aiAgent,
    dependencies: deps,
    featureCompleteness,
    scoring,
  };

  // Generate outputs
  log.info("Generating outputs...");
  const jsonPath = join(PROJECT_ROOT, "analysis-result.json");
  const mdPath = join(PROJECT_ROOT, "analysis-report.md");

  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  log.info(`JSON output: ${jsonPath}`);

  const report = generateMarkdownReport(result);
  writeFileSync(mdPath, report, "utf-8");
  log.info(`Markdown report: ${mdPath}`);

  // Summary
  log.info("=== Analysis Complete ===");
  log.info(`Total files: ${codeMetrics.totalFiles}`);
  log.info(`Total lines: ${codeMetrics.totalLines.toLocaleString()}`);
  log.info(`Endpoints: ${architecture.backend.endpoints.length}`);
  log.info(`Prisma models: ${architecture.prisma.modelCount}`);
  log.info(`Quality score: ${scoring.qualityScore}/100`);
  log.info(`Feature coverage: ${scoring.featureCoverageScore}/100`);
  log.info(`Execution time: ${executionTimeMs}ms`);
}

main().catch((err) => {
  log.error({ err }, "Analysis failed");
  process.exit(1);
});
