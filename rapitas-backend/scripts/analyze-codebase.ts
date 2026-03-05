/**
 * Rapitas Codebase Analysis Script (Enhanced v2)
 *
 * Usage: bun run rapitas-backend/scripts/analyze-codebase.ts
 * Output: analysis-result.json + analysis-report.md
 *
 * Enhanced analysis includes:
 * - File complexity & god object detection
 * - Per-feature test coverage mapping
 * - Import graph & circular dependency detection
 * - Security pattern scanning
 * - Proportional feature scoring
 * - API design consistency checks
 * - Architecture health metrics
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

// Thresholds for complexity warnings
const THRESHOLDS = {
  godObjectLines: 500,
  oversizedFileLines: 1000,
  criticalFileLines: 2000,
  maxFunctionLines: 100,
  maxNestingDepth: 5,
  maxFieldsPerModel: 30,
  maxEndpointsPerRoute: 15,
  maxImportsPerFile: 20,
};

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
  untestedSourceFiles: string[];
  score: number;
}

interface ComplexityWarning {
  file: string;
  type: "god_object" | "oversized" | "critical_size" | "deep_nesting" | "long_function" | "too_many_imports";
  message: string;
  lines: number;
  severity: "info" | "warning" | "critical";
}

interface SecurityFinding {
  file: string;
  line: number;
  type: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  snippet: string;
}

interface CircularDependency {
  cycle: string[];
}

interface APIConsistencyIssue {
  endpoint: string;
  file: string;
  type: string;
  message: string;
}

interface TestCoverageDetail {
  featureName: string;
  sourceFiles: string[];
  testFiles: string[];
  untestedFiles: string[];
  coverageRatio: number;
}

interface ArchitectureHealth {
  couplingScore: number;
  cohesionScore: number;
  modularity: number;
  highCouplingFiles: { file: string; importCount: number; importedByCount: number }[];
  isolatedFiles: string[];
  layerViolations: { file: string; message: string }[];
}

interface AnalysisResult {
  metadata: {
    generatedAt: string;
    executionTimeMs: number;
    projectRoot: string;
    version: string;
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
      oversizedModels: { name: string; fieldCount: number }[];
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
    emptyTryCatchCount: number;
    assertionCount: number;
  };
  complexity: {
    warnings: ComplexityWarning[];
    godObjects: string[];
    avgFileLines: number;
    medianFileLines: number;
    filesOver500Lines: number;
    filesOver1000Lines: number;
    longFunctions: { file: string; name: string; lines: number }[];
  };
  security: {
    findings: SecurityFinding[];
    summary: { high: number; medium: number; low: number };
  };
  imports: {
    circularDependencies: CircularDependency[];
    highFanOutFiles: { file: string; importCount: number }[];
    highFanInFiles: { file: string; importedByCount: number }[];
  };
  apiConsistency: {
    issues: APIConsistencyIssue[];
    restConformanceScore: number;
    duplicateEndpoints: { path: string; files: string[] }[];
  };
  testCoverage: {
    details: TestCoverageDetail[];
    overallCoverageRatio: number;
    untestedCriticalFiles: string[];
  };
  architectureHealth: ArchitectureHealth;
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
    architectureScore: number;
    securityScore: number;
    overallScore: number;
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

  const byDirectory: Record<string, { files: number; lines: number; size: number }> = {};
  for (const f of files) {
    const parts = f.relativePath.split(/[\\/]/);
    const topDir = parts[0] || "root";
    if (!byDirectory[topDir]) byDirectory[topDir] = { files: 0, lines: 0, size: 0 };
    byDirectory[topDir].files++;
    byDirectory[topDir].lines += f.lines;
    byDirectory[topDir].size += f.size;
  }

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
    const prefixMatch = rf.content.match(/\.group\s*\(\s*["'`]([^"'`]+)["'`]/);
    const prefix2 = rf.content.match(/prefix\s*[:=]\s*["'`]([^"'`]+)["'`]/);
    const routePrefix = prefixMatch?.[1] || prefix2?.[1] || "";

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

  const oversizedModels = models
    .filter((m) => m.fieldCount > THRESHOLDS.maxFieldsPerModel)
    .map((m) => ({ name: m.name, fieldCount: m.fieldCount }))
    .sort((a, b) => b.fieldCount - a.fieldCount);

  // Frontend components
  const componentCategories = new Map<string, string[]>();
  const frontendComponents = files.filter(
    (f) => f.relativePath.startsWith("rapitas-frontend") && f.ext === ".tsx"
  );
  for (const f of frontendComponents) {
    const parts = f.relativePath.split(/[\\/]/);
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

  const hooks = files
    .filter((f) => f.relativePath.startsWith("rapitas-frontend") && f.relativePath.includes("hooks"))
    .map((f) => basename(f.relativePath, f.ext));

  const stores = files
    .filter((f) => f.relativePath.startsWith("rapitas-frontend") && f.relativePath.includes("stores"))
    .map((f) => basename(f.relativePath, f.ext));

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
    backend: { routeFiles: routeFiles.length, endpoints, services },
    prisma: {
      modelCount: models.length,
      models,
      totalRelations: models.reduce((sum, m) => sum + m.relations.length, 0),
      oversizedModels,
    },
    frontend: { components, hooks, stores, pages },
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
  let emptyTryCatchCount = 0;
  let assertionCount = 0;

  for (const f of tsFiles) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        if (/:\s*any\b/.test(line) || /as\s+any\b/.test(line) || /<any>/.test(line)) {
          anyUsage++;
        }
      }
      if (/\/\/\s*TODO[\s:]/i.test(line)) todoCount++;
      if (/\/\/\s*FIXME[\s:]/i.test(line)) fixmeCount++;
      if (/\/\/\s*HACK[\s:]/i.test(line)) hackCount++;
      if (/console\.log\s*\(/.test(line) && !line.trim().startsWith("//")) consoleLogCount++;
      if (/\btry\s*\{/.test(line)) {
        tryCatchCount++;
        // Detect empty catch blocks: catch { } or catch(e) { }
        const remaining = lines.slice(i).join("\n");
        const emptyCatchMatch = remaining.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
        if (emptyCatchMatch) emptyTryCatchCount++;
      }
      // Count test assertions
      if (/\b(expect|assert|toBe|toEqual|toMatch|toThrow|toHaveBeenCalled)\s*\(/.test(line)) {
        assertionCount++;
      }
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
    emptyTryCatchCount,
    assertionCount,
  };
}

// ─── Complexity Analysis ──────────────────────────────────────────────────────

function collectComplexityMetrics(files: FileInfo[]): AnalysisResult["complexity"] {
  const warnings: ComplexityWarning[] = [];
  const godObjects: string[] = [];
  const longFunctions: { file: string; name: string; lines: number }[] = [];

  const tsFiles = files.filter((f) => (f.ext === ".ts" || f.ext === ".tsx") && !f.relativePath.match(/\.(test|spec)\./));

  for (const f of tsFiles) {
    // God object detection (services/components with too many methods/exports)
    if (f.lines > THRESHOLDS.criticalFileLines) {
      warnings.push({
        file: f.relativePath,
        type: "critical_size",
        message: `Critical: ${f.lines} lines - immediate refactoring needed`,
        lines: f.lines,
        severity: "critical",
      });
      godObjects.push(f.relativePath);
    } else if (f.lines > THRESHOLDS.oversizedFileLines) {
      warnings.push({
        file: f.relativePath,
        type: "oversized",
        message: `Oversized: ${f.lines} lines - consider splitting`,
        lines: f.lines,
        severity: "warning",
      });
    } else if (f.lines > THRESHOLDS.godObjectLines) {
      // Check if it has many exports (god object indicator)
      const exportCount = (f.content.match(/\bexport\s+(function|class|const|interface|type|async\s+function)/g) || []).length;
      if (exportCount > 10) {
        warnings.push({
          file: f.relativePath,
          type: "god_object",
          message: `Potential god object: ${f.lines} lines with ${exportCount} exports`,
          lines: f.lines,
          severity: "warning",
        });
        godObjects.push(f.relativePath);
      }
    }

    // Long function detection (standalone functions, not React components or class methods)
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
    let funcMatch;
    const lines = f.content.split("\n");
    while ((funcMatch = funcRegex.exec(f.content)) !== null) {
      const funcName = funcMatch[1];
      // Skip React component functions (PascalCase in .tsx files)
      if (f.ext === ".tsx" && /^[A-Z]/.test(funcName)) continue;
      const startLine = f.content.substring(0, funcMatch.index).split("\n").length;
      // Find matching brace end
      let depth = 0;
      let funcEnd = startLine;
      let foundStart = false;
      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
          if (ch === "{") { depth++; foundStart = true; }
          if (ch === "}") depth--;
          if (foundStart && depth === 0) {
            funcEnd = i + 1;
            break;
          }
        }
        if (foundStart && depth === 0) break;
      }
      const funcLines = funcEnd - startLine + 1;
      if (funcLines > THRESHOLDS.maxFunctionLines) {
        longFunctions.push({ file: f.relativePath, name: funcName, lines: funcLines });
      }
    }

    // Deep nesting detection
    let maxDepth = 0;
    let currentDepth = 0;
    for (const line of lines) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      currentDepth += opens - closes;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
    }
    if (maxDepth > THRESHOLDS.maxNestingDepth) {
      warnings.push({
        file: f.relativePath,
        type: "deep_nesting",
        message: `Max nesting depth: ${maxDepth} levels`,
        lines: f.lines,
        severity: maxDepth > 8 ? "warning" : "info",
      });
    }

    // Too many imports
    const importCount = (f.content.match(/^import\s+/gm) || []).length;
    if (importCount > THRESHOLDS.maxImportsPerFile) {
      warnings.push({
        file: f.relativePath,
        type: "too_many_imports",
        message: `${importCount} imports - may indicate low cohesion`,
        lines: f.lines,
        severity: importCount > 30 ? "warning" : "info",
      });
    }
  }

  // File line statistics
  const tsFilesLines = tsFiles.map((f) => f.lines).sort((a, b) => a - b);
  const avgFileLines = tsFilesLines.length > 0 ? Math.round(tsFilesLines.reduce((a, b) => a + b, 0) / tsFilesLines.length) : 0;
  const medianFileLines = tsFilesLines.length > 0 ? tsFilesLines[Math.floor(tsFilesLines.length / 2)] : 0;

  return {
    warnings: warnings.sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, info: 2 };
      return sevOrder[a.severity] - sevOrder[b.severity] || b.lines - a.lines;
    }),
    godObjects,
    avgFileLines,
    medianFileLines,
    filesOver500Lines: tsFiles.filter((f) => f.lines > 500).length,
    filesOver1000Lines: tsFiles.filter((f) => f.lines > 1000).length,
    longFunctions: longFunctions.sort((a, b) => b.lines - a.lines).slice(0, 20),
  };
}

// ─── Security Analysis ────────────────────────────────────────────────────────

function collectSecurityFindings(files: FileInfo[]): AnalysisResult["security"] {
  const findings: SecurityFinding[] = [];
  const tsFiles = files.filter((f) => f.ext === ".ts" || f.ext === ".tsx");

  const patterns: { regex: RegExp; type: string; message: string; severity: SecurityFinding["severity"]; excludePatterns?: RegExp[] }[] = [
    {
      regex: /(?:password|secret|apikey|api_key|token)\s*=\s*["'][A-Za-z0-9+/=_-]{16,}["']/i,
      type: "hardcoded_secret",
      message: "Potential hardcoded secret or credential",
      severity: "high",
      // Exclude masked values, empty strings, placeholders, env references
      excludePatterns: [/\*{3,}/, /placeholder/i, /example/i, /your[-_]?/i, /process\.env/, /Bun\.env/],
    },
    {
      regex: /\beval\s*\([^)]/,
      type: "eval_usage",
      message: "Use of eval() - potential code injection risk",
      severity: "high",
      // Exclude string literals mentioning eval (like in this script's patterns)
      excludePatterns: [/["'`].*eval/, /regex/i, /pattern/i, /message.*eval/i],
    },
    {
      regex: /dangerouslySetInnerHTML\s*=\s*\{\{/,
      type: "xss_risk",
      message: "dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized.",
      severity: "medium",
      // Exclude string literals mentioning the property
      excludePatterns: [/["'`].*dangerouslySetInnerHTML/, /regex/i],
    },
    {
      regex: /\$\(|`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\s+.*\$\{/i,
      type: "sql_injection",
      message: "Potential SQL injection via string interpolation in SQL query",
      severity: "high",
    },
    {
      regex: /(?:execSync|exec|spawn|spawnSync)\s*\(\s*`[^`]*\$\{/,
      type: "command_injection",
      message: "Template literal in child process - verify input is not user-controlled",
      severity: "medium",
      // where/which commands for tool resolution are low risk
      excludePatterns: [/where\s+\$\{/, /which\s+\$\{/],
    },
    {
      regex: /new\s+RegExp\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
      type: "regex_injection",
      message: "User input in RegExp constructor - potential ReDoS",
      severity: "medium",
    },
    {
      regex: /cors\s*\(\s*\{\s*origin\s*:\s*["'`]\*["'`]/,
      type: "cors_wildcard",
      message: "CORS wildcard origin - allows any domain",
      severity: "medium",
    },
    {
      regex: /\.writeFile(?:Sync)?\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
      type: "path_traversal",
      message: "User input in file write path - potential path traversal",
      severity: "high",
    },
    {
      regex: /(?:readFile|readFileSync|createReadStream)\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
      type: "path_traversal",
      message: "User input in file read path - potential path traversal",
      severity: "medium",
    },
    {
      regex: /(?:JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY)\s*=\s*["'][A-Za-z0-9+/=_-]{8,}["']/,
      type: "hardcoded_key",
      message: "Hardcoded cryptographic key or session secret",
      severity: "critical",
      excludePatterns: [/process\.env/, /Bun\.env/, /import\.meta\.env/],
    },
  ];

  for (const f of tsFiles) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      // Skip test files for some checks
      const isTest = f.relativePath.match(/\.(test|spec)\./);
      const isDemo = f.relativePath.includes("demo") || f.relativePath.includes("example") || f.relativePath.includes("stories");

      for (const p of patterns) {
        if (isTest && (p.type === "hardcoded_secret" || p.type === "hardcoded_key")) continue;
        if (isDemo && (p.type === "eval_usage" || p.type === "xss_risk")) continue;
        if (p.regex.test(line)) {
          // Skip type definitions and interface declarations
          if (/^\s*(type|interface)\s/.test(line)) continue;
          // Skip lines that are regex/pattern definitions (avoid self-detection)
          if (/regex\s*[:=]|new\s+RegExp|\/.*\/[gimsuy]*/.test(line) && p.type !== "regex_injection") continue;
          // Skip log/message/error strings (template literals used in logging, not SQL)
          if (p.type === "sql_injection" && /log\.|logger\.|console\.|message|error|info|debug|warn/.test(line)) continue;
          // Apply exclude patterns
          if (p.excludePatterns?.some((ep) => ep.test(line))) continue;

          findings.push({
            file: f.relativePath,
            line: i + 1,
            type: p.type,
            message: p.message,
            severity: p.severity,
            snippet: line.trim().substring(0, 120),
          });
        }
      }
    }
  }

  const summary = {
    high: findings.filter((f) => f.severity === "high" || f.severity === "critical").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  return { findings, summary };
}

// ─── Import Graph & Circular Dependencies ─────────────────────────────────────

function collectImportMetrics(files: FileInfo[]): AnalysisResult["imports"] {
  const tsFiles = files.filter((f) => (f.ext === ".ts" || f.ext === ".tsx") && !f.relativePath.includes("node_modules"));

  // Build import graph
  const importGraph = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();

  for (const f of tsFiles) {
    const imports = new Set<string>();
    const importRegex = /import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?["'`]([^"'`]+)["'`]/g;
    let match;
    while ((match = importRegex.exec(f.content)) !== null) {
      const importPath = match[1];
      // Only track local imports
      if (importPath.startsWith(".") || importPath.startsWith("@/")) {
        // Resolve relative path
        let resolvedBase: string;
        if (importPath.startsWith("@/")) {
          // Assume @/ maps to src/
          const srcDir = f.relativePath.startsWith("rapitas-frontend")
            ? "rapitas-frontend/src"
            : f.relativePath.startsWith("rapitas-backend")
              ? "rapitas-backend"
              : "";
          resolvedBase = srcDir ? join(srcDir, importPath.slice(2)) : importPath;
        } else {
          resolvedBase = join(dirname(f.relativePath), importPath).replace(/\\/g, "/");
        }
        // Normalize: remove extension, add .ts if needed
        const normalized = resolvedBase.replace(/\.(ts|tsx|js|jsx)$/, "").replace(/\\/g, "/");
        imports.add(normalized);

        if (!importedBy.has(normalized)) importedBy.set(normalized, new Set());
        importedBy.get(normalized)!.add(f.relativePath.replace(/\\/g, "/"));
      }
    }
    importGraph.set(f.relativePath.replace(/\\/g, "/"), imports);
  }

  // Detect circular dependencies (DFS with cycle detection, limited depth)
  const circularDeps: CircularDependency[] = [];
  const visited = new Set<string>();

  function findCycles(node: string, path: string[], depthLimit: number): void {
    if (depthLimit <= 0) return;
    if (path.includes(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      // Deduplicate: normalize cycle to start from lexically smallest
      const minIdx = cycle.indexOf([...cycle].sort()[0]);
      const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
      const key = normalized.join(" -> ");
      if (!visited.has(key)) {
        visited.add(key);
        circularDeps.push({ cycle: normalized });
      }
      return;
    }

    const imports = importGraph.get(node);
    if (!imports) return;

    for (const imp of imports) {
      findCycles(imp, [...path, node], depthLimit - 1);
    }
  }

  for (const node of importGraph.keys()) {
    findCycles(node, [], 8);
    if (circularDeps.length > 50) break; // Limit output
  }

  // High fan-out (files importing many others)
  const highFanOutFiles = [...importGraph.entries()]
    .map(([file, imports]) => ({ file, importCount: imports.size }))
    .filter((f) => f.importCount > 10)
    .sort((a, b) => b.importCount - a.importCount)
    .slice(0, 15);

  // High fan-in (files imported by many others)
  const highFanInFiles = [...importedBy.entries()]
    .map(([file, importers]) => ({ file, importedByCount: importers.size }))
    .filter((f) => f.importedByCount > 5)
    .sort((a, b) => b.importedByCount - a.importedByCount)
    .slice(0, 15);

  return {
    circularDependencies: circularDeps.slice(0, 30),
    highFanOutFiles,
    highFanInFiles,
  };
}

// ─── API Consistency Analysis ─────────────────────────────────────────────────

function collectAPIConsistency(endpoints: Endpoint[]): AnalysisResult["apiConsistency"] {
  const issues: APIConsistencyIssue[] = [];

  for (const ep of endpoints) {
    // Check REST naming conventions
    // 1. Collection endpoints should be plural nouns
    const pathParts = ep.path.split("/").filter(Boolean);
    const resource = pathParts.find((p) => !p.startsWith(":") && p !== "api");

    // 2. Verbs in URLs (anti-pattern for REST)
    const verbPatterns = /\/(execute|create|update|delete|remove|fetch|get|set|generate|validate|analyze|detect|format|seed|send|start|stop|pause|resume|complete|cancel|record|log|check|capture|download|upload|browse)\b/i;
    const verbMatch = ep.path.match(verbPatterns);
    if (verbMatch && ep.method !== "POST") {
      issues.push({
        endpoint: `${ep.method} ${ep.path}`,
        file: ep.file,
        type: "verb_in_url",
        message: `Verb "${verbMatch[1]}" in URL with ${ep.method} method. REST prefers nouns in URLs with HTTP verbs indicating the action.`,
      });
    }

    // 3. Inconsistent path casing (should be kebab-case)
    for (const part of pathParts) {
      if (part.startsWith(":")) continue;
      if (/[A-Z]/.test(part) || /_/.test(part)) {
        issues.push({
          endpoint: `${ep.method} ${ep.path}`,
          file: ep.file,
          type: "inconsistent_casing",
          message: `Path segment "${part}" uses non-kebab-case. REST convention prefers kebab-case.`,
        });
        break;
      }
    }

    // 4. POST for operations that should be GET (idempotent reads)
    if (ep.method === "POST" && /\/(search|suggest|analyze|check|validate|detect)/.test(ep.path)) {
      // This is actually acceptable for complex queries, so mark as info
    }

    // 5. Missing resource ID in singular operations
    if ((ep.method === "PATCH" || ep.method === "DELETE") && !ep.path.includes(":")) {
      issues.push({
        endpoint: `${ep.method} ${ep.path}`,
        file: ep.file,
        type: "missing_id",
        message: `${ep.method} without resource identifier in path`,
      });
    }
  }

  // Duplicate endpoints (same method + path from different files)
  const endpointMap = new Map<string, string[]>();
  for (const ep of endpoints) {
    const key = `${ep.method} ${ep.path}`;
    const files = endpointMap.get(key) || [];
    files.push(ep.file);
    endpointMap.set(key, files);
  }
  const duplicateEndpoints = [...endpointMap.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([path, files]) => ({ path, files: [...new Set(files)] }));

  // REST conformance score
  const totalEndpoints = endpoints.length;
  const issueCount = issues.length;
  const restConformanceScore = totalEndpoints > 0
    ? Math.max(0, Math.round(100 - (issueCount / totalEndpoints) * 100))
    : 100;

  return { issues, restConformanceScore, duplicateEndpoints };
}

// ─── Test Coverage Details ────────────────────────────────────────────────────

function collectTestCoverage(files: FileInfo[], featureAreas: { name: string; keywords: string[] }[]): AnalysisResult["testCoverage"] {
  const testFiles = files.filter((f) => f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/));
  const sourceFiles = files.filter(
    (f) => (f.ext === ".ts" || f.ext === ".tsx") && !f.relativePath.match(/\.(test|spec)\./) && !f.relativePath.includes("__tests__")
  );

  const details: TestCoverageDetail[] = featureAreas.map((area) => {
    const matchesKeyword = (path: string) =>
      area.keywords.some((kw) => path.toLowerCase().includes(kw));

    const areaSourceFiles = sourceFiles
      .filter((f) => matchesKeyword(f.relativePath))
      .map((f) => f.relativePath);
    const areaTestFiles = testFiles
      .filter((f) => matchesKeyword(f.relativePath))
      .map((f) => f.relativePath);

    // Find untested source files (no corresponding test file)
    const testedPatterns = areaTestFiles.map((t) => {
      const base = basename(t).replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "");
      return base.toLowerCase();
    });

    const untestedFiles = areaSourceFiles.filter((src) => {
      const srcBase = basename(src, extname(src)).toLowerCase();
      return !testedPatterns.some((tp) => tp === srcBase || srcBase.includes(tp) || tp.includes(srcBase));
    });

    const coverageRatio = areaSourceFiles.length > 0
      ? Math.round(((areaSourceFiles.length - untestedFiles.length) / areaSourceFiles.length) * 100) / 100
      : 1;

    return {
      featureName: area.name,
      sourceFiles: areaSourceFiles,
      testFiles: areaTestFiles,
      untestedFiles,
      coverageRatio,
    };
  });

  // Find critical untested files (large source files without tests)
  const criticalUntested = sourceFiles
    .filter((f) => f.lines > 200)
    .filter((f) => {
      const srcBase = basename(f.relativePath, extname(f.relativePath)).toLowerCase();
      return !testFiles.some((t) => {
        const testBase = basename(t.relativePath).replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "").toLowerCase();
        return testBase === srcBase || srcBase.includes(testBase) || testBase.includes(srcBase);
      });
    })
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 20)
    .map((f) => `${f.relativePath} (${f.lines} lines)`);

  const totalSource = details.reduce((sum, d) => sum + d.sourceFiles.length, 0);
  const totalUntested = details.reduce((sum, d) => sum + d.untestedFiles.length, 0);
  const overallCoverageRatio = totalSource > 0 ? Math.round(((totalSource - totalUntested) / totalSource) * 100) / 100 : 1;

  return { details, overallCoverageRatio, untestedCriticalFiles: criticalUntested };
}

// ─── Architecture Health ──────────────────────────────────────────────────────

function collectArchitectureHealth(files: FileInfo[], importMetrics: AnalysisResult["imports"]): ArchitectureHealth {
  const tsFiles = files.filter((f) => (f.ext === ".ts" || f.ext === ".tsx") && !f.relativePath.match(/\.(test|spec)\./));

  // Layer violation detection (frontend importing from backend, routes importing from other routes, etc.)
  const layerViolations: { file: string; message: string }[] = [];
  for (const f of tsFiles) {
    if (f.relativePath.startsWith("rapitas-frontend")) {
      // Frontend should not directly import backend modules
      if (/from\s+["'`].*rapitas-backend/.test(f.content)) {
        layerViolations.push({
          file: f.relativePath,
          message: "Frontend file imports directly from backend",
        });
      }
    }
    if (f.relativePath.includes("routes") && f.relativePath.startsWith("rapitas-backend")) {
      // Route files should not import from other route files (go through services)
      const routeImports = f.content.match(/from\s+["'`]\..*routes/g);
      if (routeImports && routeImports.length > 0) {
        layerViolations.push({
          file: f.relativePath,
          message: "Route file imports from another route file (should go through services)",
        });
      }
    }
    if (f.relativePath.includes("services") && f.relativePath.startsWith("rapitas-backend")) {
      // Services should not import from routes
      if (/from\s+["'`].*routes/.test(f.content)) {
        layerViolations.push({
          file: f.relativePath,
          message: "Service file imports from routes (inverted dependency)",
        });
      }
    }
  }

  // Coupling score (lower is better): based on average fan-out
  const fanOutValues = importMetrics.highFanOutFiles.map((f) => f.importCount);
  const avgFanOut = fanOutValues.length > 0 ? fanOutValues.reduce((a, b) => a + b, 0) / fanOutValues.length : 0;
  const couplingScore = Math.max(0, Math.min(100, Math.round(100 - avgFanOut * 3)));

  // Cohesion score: based on feature modularity (files in same directory import each other)
  const dirGroups = new Map<string, number>();
  for (const f of tsFiles) {
    const dir = dirname(f.relativePath);
    dirGroups.set(dir, (dirGroups.get(dir) || 0) + 1);
  }
  // Good cohesion = small directories with focused files
  const dirSizes = [...dirGroups.values()];
  const avgDirSize = dirSizes.length > 0 ? dirSizes.reduce((a, b) => a + b, 0) / dirSizes.length : 0;
  const cohesionScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, avgDirSize - 5) * 5)));

  // Modularity: ratio of well-structured directories
  const wellStructured = dirSizes.filter((s) => s >= 2 && s <= 15).length;
  const modularity = dirSizes.length > 0 ? Math.round((wellStructured / dirSizes.length) * 100) : 0;

  // High coupling files
  const highCouplingFiles = importMetrics.highFanOutFiles.slice(0, 10).map((f) => {
    const fanIn = importMetrics.highFanInFiles.find((fi) => fi.file === f.file);
    return {
      file: f.file,
      importCount: f.importCount,
      importedByCount: fanIn?.importedByCount || 0,
    };
  });

  // Isolated files (no imports AND not imported by others)
  const allImportedFiles = new Set(importMetrics.highFanInFiles.map((f) => f.file));
  const isolatedFiles = tsFiles
    .filter((f) => {
      const normalized = f.relativePath.replace(/\\/g, "/");
      const importCount = (f.content.match(/^import\s+/gm) || []).length;
      return importCount === 0 && !allImportedFiles.has(normalized);
    })
    .map((f) => f.relativePath)
    .slice(0, 10);

  return {
    couplingScore,
    cohesionScore,
    modularity,
    highCouplingFiles,
    isolatedFiles,
    layerViolations,
  };
}

// ─── AI/Agent Metrics ─────────────────────────────────────────────────────────

function collectAIAgentMetrics(files: FileInfo[]): AnalysisResult["aiAgent"] {
  const providers: Set<string> = new Set();
  const agentTypes: Set<string> = new Set();

  for (const f of files) {
    if (!f.relativePath.startsWith("rapitas-backend")) continue;
    if (f.ext !== ".ts") continue;

    if (f.content.includes("@anthropic-ai/sdk") || f.content.includes("Anthropic")) providers.add("Anthropic (Claude)");
    if (f.content.includes("openai") || f.content.includes("OpenAI")) providers.add("OpenAI");
    if (f.content.includes("@google/generative-ai") || f.content.includes("GoogleGenerativeAI")) providers.add("Google (Gemini)");

    if (f.relativePath.includes("agent")) {
      const typeMatches = f.content.matchAll(/agentType['":\s]*["'`](\w+)["'`]/g);
      for (const m of typeMatches) {
        agentTypes.add(m[1]);
      }
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

// ─── Feature Completeness (Enhanced Proportional Scoring) ─────────────────────

const FEATURE_AREAS_CONFIG = [
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

function collectFeatureCompleteness(
  files: FileInfo[],
  arch: AnalysisResult["architecture"]
): FeatureArea[] {
  const testFiles = files.filter((f) => f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/));
  const sourceFiles = files.filter(
    (f) => (f.ext === ".ts" || f.ext === ".tsx") && !f.relativePath.match(/\.(test|spec)\./)
  );

  return FEATURE_AREAS_CONFIG.map((area) => {
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

    // Find untested source files for this feature
    const featureSourceFiles = sourceFiles.filter((f) => matchesKeyword(f.relativePath));
    const featureTestBases = testFiles
      .filter((f) => matchesKeyword(f.relativePath))
      .map((f) => basename(f.relativePath).replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "").toLowerCase());
    const untestedSourceFiles = featureSourceFiles
      .filter((f) => {
        const srcBase = basename(f.relativePath, extname(f.relativePath)).toLowerCase();
        return !featureTestBases.some((tb) => tb === srcBase || srcBase.includes(tb) || tb.includes(srcBase));
      })
      .map((f) => f.relativePath);

    // Proportional scoring (weighted, not binary)
    // Routes: 0-20 (scaled: 1 route = 5pts, capped at 20)
    // Services: 0-20 (scaled: 1 service = 5pts, capped at 20)
    // Components: 0-20 (scaled: 1 component = 3pts, capped at 20)
    // Hooks: 0-10 (scaled: 1 hook = 5pts, capped at 10)
    // Models: 0-15 (scaled: 1 model = 5pts, capped at 15)
    // Tests: 0-15 (scaled: 1 test = 5pts, capped at 15)
    let score = 0;
    score += Math.min(20, routes * 5);
    score += Math.min(20, services * 5);
    score += Math.min(20, components * 3);
    score += Math.min(10, hooks * 5);
    score += Math.min(15, models * 5);
    score += Math.min(15, tests * 5);

    return { name: area.name, routes, services, components, hooks, models, tests, untestedSourceFiles, score };
  });
}

// ─── Scoring (Enhanced Multi-dimensional) ─────────────────────────────────────

function computeScoring(
  quality: AnalysisResult["quality"],
  features: FeatureArea[],
  arch: AnalysisResult["architecture"],
  codeMetrics: AnalysisResult["codeMetrics"],
  complexity: AnalysisResult["complexity"],
  security: AnalysisResult["security"],
  apiConsistency: AnalysisResult["apiConsistency"],
  archHealth: ArchitectureHealth
): AnalysisResult["scoring"] {
  // ── Quality Score (0-100) ──
  let qualityScore = 40; // base

  // Test coverage impact (0-25 points)
  if (quality.testRatio >= 0.5) qualityScore += 25;
  else if (quality.testRatio >= 0.3) qualityScore += 20;
  else if (quality.testRatio >= 0.2) qualityScore += 15;
  else if (quality.testRatio >= 0.1) qualityScore += 10;
  else if (quality.testRatio >= 0.05) qualityScore += 5;
  else qualityScore -= 5;

  // Type safety (0-15 points)
  const anyPer1000 = (quality.anyUsage / (codeMetrics.totalLines / 1000));
  if (anyPer1000 < 0.5) qualityScore += 15;
  else if (anyPer1000 < 1) qualityScore += 10;
  else if (anyPer1000 < 3) qualityScore += 5;
  else if (anyPer1000 > 10) qualityScore -= 10;

  // Code hygiene (0-10 points)
  if (quality.consoleLogCount === 0) qualityScore += 5;
  else if (quality.consoleLogCount < 10) qualityScore += 3;
  else if (quality.consoleLogCount > 50) qualityScore -= 5;

  if (quality.todoCount + quality.fixmeCount + quality.hackCount === 0) qualityScore += 5;
  else if (quality.todoCount + quality.fixmeCount > 20) qualityScore -= 5;

  // Empty catch blocks penalty
  if (quality.emptyTryCatchCount > 20) qualityScore -= 10;
  else if (quality.emptyTryCatchCount > 5) qualityScore -= 5;

  // Complexity penalty
  if (complexity.godObjects.length > 5) qualityScore -= 10;
  else if (complexity.godObjects.length > 2) qualityScore -= 5;

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  // ── Feature Coverage Score ──
  const featureCoverageScore = Math.round(
    features.reduce((sum, f) => sum + f.score, 0) / features.length
  );

  // ── Architecture Score (0-100) ──
  let architectureScore = 50;

  // API richness
  if (arch.backend.endpoints.length > 100) architectureScore += 10;
  else if (arch.backend.endpoints.length > 50) architectureScore += 5;

  // Model richness
  if (arch.prisma.modelCount > 30) architectureScore += 5;

  // REST conformance
  architectureScore += Math.round(apiConsistency.restConformanceScore * 0.1);

  // Layer violation penalty
  if (archHealth.layerViolations.length > 10) architectureScore -= 15;
  else if (archHealth.layerViolations.length > 5) architectureScore -= 10;
  else if (archHealth.layerViolations.length > 0) architectureScore -= 5;

  // Coupling/cohesion
  architectureScore += Math.round(archHealth.couplingScore * 0.05);
  architectureScore += Math.round(archHealth.cohesionScore * 0.05);

  // God object penalty
  if (complexity.godObjects.length > 3) architectureScore -= 10;
  else if (complexity.godObjects.length > 0) architectureScore -= 5;

  // Duplicate endpoints penalty
  if (apiConsistency.duplicateEndpoints.length > 5) architectureScore -= 10;
  else if (apiConsistency.duplicateEndpoints.length > 0) architectureScore -= 5;

  architectureScore = Math.max(0, Math.min(100, architectureScore));

  // ── Security Score (0-100) ──
  // Scaled by total codebase size to avoid over-penalizing large codebases
  const criticalFindings = security.findings.filter((f) => f.severity === "critical").length;
  let securityScore = 100;
  securityScore -= criticalFindings * 20;
  securityScore -= (security.summary.high - criticalFindings) * 8;
  securityScore -= security.summary.medium * 3;
  securityScore -= security.summary.low * 1;
  securityScore = Math.max(0, Math.min(100, securityScore));

  // ── Overall Score ──
  const overallScore = Math.round(
    qualityScore * 0.3 +
    featureCoverageScore * 0.25 +
    architectureScore * 0.25 +
    securityScore * 0.2
  );

  // ── Strengths, Weaknesses, Suggestions ──
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];

  // Strengths
  if (arch.backend.endpoints.length > 80) strengths.push(`豊富なAPIエンドポイント（${arch.backend.endpoints.length}件）`);
  if (arch.prisma.modelCount > 30) strengths.push(`充実したデータモデル（${arch.prisma.modelCount}モデル）`);
  if (arch.frontend.pages.length > 15) strengths.push(`多彩なフロントエンドページ（${arch.frontend.pages.length}ルート）`);
  if (arch.frontend.hooks.length > 10) strengths.push(`再利用可能なカスタムフック（${arch.frontend.hooks.length}個）`);
  if (quality.anyUsage < 20) strengths.push(`型安全性が高い（any使用: ${quality.anyUsage}箇所）`);
  if (quality.consoleLogCount < 10) strengths.push(`ログ出力が適切に管理されている`);
  if (security.summary.high === 0) strengths.push(`重大なセキュリティリスクが検出されていない`);
  if (archHealth.layerViolations.length === 0) strengths.push(`レイヤー間の依存関係が適切`);

  const strongFeatures = features.filter((f) => f.score >= 75);
  if (strongFeatures.length > 0) {
    strengths.push(`高カバレッジ機能: ${strongFeatures.map((f) => f.name).join(", ")}`);
  }

  // Weaknesses
  if (quality.testRatio < 0.1) weaknesses.push(`テストカバレッジが低い（テスト比率: ${(quality.testRatio * 100).toFixed(1)}%）`);
  if (quality.anyUsage > 50) weaknesses.push(`any型の使用が多い（${quality.anyUsage}箇所）`);
  if (quality.consoleLogCount > 50) weaknesses.push(`console.logが多い（${quality.consoleLogCount}箇所）`);
  if (quality.emptyTryCatchCount > 5) weaknesses.push(`空のcatchブロック（${quality.emptyTryCatchCount}箇所）- エラーが無視されている`);
  if (complexity.godObjects.length > 0) weaknesses.push(`God Object検出: ${complexity.godObjects.length}ファイル（${complexity.godObjects.slice(0, 3).join(", ")}）`);
  if (complexity.filesOver1000Lines > 5) weaknesses.push(`1000行超のファイルが${complexity.filesOver1000Lines}個`);
  if (archHealth.layerViolations.length > 0) weaknesses.push(`レイヤー違反: ${archHealth.layerViolations.length}件`);
  if (apiConsistency.duplicateEndpoints.length > 0) weaknesses.push(`重複エンドポイント: ${apiConsistency.duplicateEndpoints.length}件`);
  if (arch.prisma.oversizedModels.length > 0) {
    weaknesses.push(`巨大なPrismaモデル: ${arch.prisma.oversizedModels.map((m) => `${m.name}(${m.fieldCount}フィールド)`).join(", ")}`);
  }

  const weakFeatures = features.filter((f) => f.score < 50);
  if (weakFeatures.length > 0) {
    weaknesses.push(`低カバレッジ機能: ${weakFeatures.map((f) => f.name).join(", ")}`);
  }

  // Suggestions (prioritized)
  if (quality.testRatio < 0.2) {
    const untestedCount = features.reduce((sum, f) => sum + f.untestedSourceFiles.length, 0);
    suggestions.push(`[P0] テスト拡充 - ${untestedCount}個の未テストソースファイル。特にバックエンドサービスのユニットテストを優先`);
  }
  if (complexity.godObjects.length > 0) {
    suggestions.push(`[P0] God Objectのリファクタリング - ${complexity.godObjects.slice(0, 3).join(", ")} を分割`);
  }
  if (security.summary.high > 0) {
    suggestions.push(`[P0] セキュリティ修正 - ${security.summary.high}件の高リスク検出を修正`);
  }
  if (quality.emptyTryCatchCount > 5) {
    suggestions.push(`[P1] 空のcatchブロックにエラーログまたはリスローを追加`);
  }
  if (archHealth.layerViolations.length > 0) {
    suggestions.push(`[P1] レイヤー違反の解消 - ${archHealth.layerViolations.length}件の不正なimportを修正`);
  }
  if (apiConsistency.duplicateEndpoints.length > 0) {
    suggestions.push(`[P1] 重複エンドポイントの統合`);
  }
  if (arch.prisma.oversizedModels.length > 0) {
    suggestions.push(`[P2] 巨大Prismaモデルの正規化（${arch.prisma.oversizedModels[0]?.name}: ${arch.prisma.oversizedModels[0]?.fieldCount}フィールド）`);
  }
  if (weakFeatures.length > 0) {
    suggestions.push(`[P2] 機能拡充: ${weakFeatures.map((f) => f.name).join(", ")}`);
  }
  if (quality.anyUsage > 30) {
    suggestions.push(`[P2] any型を具体的な型に置き換え`);
  }

  return { qualityScore, featureCoverageScore, architectureScore, securityScore, overallScore, strengths, weaknesses, suggestions };
}

// ─── Markdown Report (Enhanced) ──────────────────────────────────────────────

function generateMarkdownReport(result: AnalysisResult): string {
  const { metadata, codeMetrics, architecture, quality, aiAgent, dependencies, featureCompleteness, scoring, complexity, security, imports, apiConsistency, testCoverage, architectureHealth } = result;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const severityEmoji = (s: string) => {
    switch (s) {
      case "critical": return "[CRITICAL]";
      case "high": return "[HIGH]";
      case "warning": return "[WARN]";
      case "medium": return "[MEDIUM]";
      case "low": return "[LOW]";
      case "info": return "[INFO]";
      default: return "";
    }
  };

  let md = `# Rapitas Codebase Analysis Report (v${metadata.version})

> Generated: ${metadata.generatedAt}
> Execution time: ${metadata.executionTimeMs}ms
> Project root: \`${metadata.projectRoot}\`

---

## Summary Dashboard

| Metric | Score |
|--------|-------|
| Overall Score | **${scoring.overallScore}/100** |
| Quality Score | ${scoring.qualityScore}/100 |
| Feature Coverage | ${scoring.featureCoverageScore}/100 |
| Architecture Score | ${scoring.architectureScore}/100 |
| Security Score | ${scoring.securityScore}/100 |

---

## 1. Code Metrics

### Summary
| Item | Value |
|------|-------|
| Total files | ${codeMetrics.totalFiles} |
| Total lines | ${codeMetrics.totalLines.toLocaleString()} |
| Total size | ${formatBytes(codeMetrics.totalSize)} |
| Avg file lines | ${complexity.avgFileLines} |
| Median file lines | ${complexity.medianFileLines} |
| Files > 500 lines | ${complexity.filesOver500Lines} |
| Files > 1000 lines | ${complexity.filesOver1000Lines} |

### By Extension
| Extension | Files | Lines | Size | Avg Lines |
|-----------|-------|-------|------|-----------|
${codeMetrics.byExtension.map((e) => `| ${e.extension} | ${e.fileCount} | ${e.totalLines.toLocaleString()} | ${formatBytes(e.totalSize)} | ${e.avgLines} |`).join("\n")}

### By Directory
| Directory | Files | Lines | Size |
|-----------|-------|-------|------|
${Object.entries(codeMetrics.byDirectory)
  .sort(([, a], [, b]) => b.lines - a.lines)
  .map(([dir, d]) => `| ${dir} | ${d.files} | ${d.lines.toLocaleString()} | ${formatBytes(d.size)} |`)
  .join("\n")}

### Largest Files Top20
| # | File | Lines | Size |
|---|------|-------|------|
${codeMetrics.largestFiles.map((f, i) => `| ${i + 1} | \`${f.path}\` | ${f.lines.toLocaleString()} | ${formatBytes(f.size)} |`).join("\n")}

---

## 2. Complexity Analysis

### God Objects (${complexity.godObjects.length} detected)
${complexity.godObjects.length > 0
  ? complexity.godObjects.map((g) => `- \`${g}\``).join("\n")
  : "None detected"}

### Complexity Warnings (${complexity.warnings.length} total)
${complexity.warnings.length > 0
  ? `| Severity | File | Type | Message |
|----------|------|------|---------|
${complexity.warnings.slice(0, 30).map((w) => `| ${severityEmoji(w.severity)} | \`${w.file}\` | ${w.type} | ${w.message} |`).join("\n")}`
  : "No warnings"}

### Long Functions (> ${THRESHOLDS.maxFunctionLines} lines)
${complexity.longFunctions.length > 0
  ? `| File | Function | Lines |
|------|----------|-------|
${complexity.longFunctions.map((f) => `| \`${f.file}\` | ${f.name} | ${f.lines} |`).join("\n")}`
  : "None detected"}

---

## 3. Security Analysis

### Summary
| Severity | Count |
|----------|-------|
| High/Critical | ${security.summary.high} |
| Medium | ${security.summary.medium} |
| Low | ${security.summary.low} |
| **Security Score** | **${scoring.securityScore}/100** |

${security.findings.length > 0
  ? `### Findings
| Severity | File | Line | Type | Message |
|----------|------|------|------|---------|
${security.findings.slice(0, 30).map((f) => `| ${severityEmoji(f.severity)} | \`${f.file}\` | ${f.line} | ${f.type} | ${f.message} |`).join("\n")}`
  : "No security issues detected"}

---

## 4. Architecture

### Backend
- **Route files**: ${architecture.backend.routeFiles}
- **Endpoints**: ${architecture.backend.endpoints.length}
- **Services**: ${architecture.backend.services.length}

### Prisma Models
- **Models**: ${architecture.prisma.modelCount}
- **Relations**: ${architecture.prisma.totalRelations}
${architecture.prisma.oversizedModels.length > 0
  ? `- **Oversized models** (> ${THRESHOLDS.maxFieldsPerModel} fields): ${architecture.prisma.oversizedModels.map((m) => `${m.name}(${m.fieldCount})`).join(", ")}`
  : ""}

### Frontend
${architecture.frontend.components.map((c) => `- **${c.category}**: ${c.count} files`).join("\n")}
- **Custom hooks**: ${architecture.frontend.hooks.length}
- **Stores**: ${architecture.frontend.stores.length}
- **Page routes**: ${architecture.frontend.pages.length}

### Architecture Health
| Metric | Score |
|--------|-------|
| Coupling Score | ${architectureHealth.couplingScore}/100 (lower coupling = better) |
| Cohesion Score | ${architectureHealth.cohesionScore}/100 |
| Modularity | ${architectureHealth.modularity}% |
| Layer Violations | ${architectureHealth.layerViolations.length} |

${architectureHealth.layerViolations.length > 0
  ? `#### Layer Violations
| File | Issue |
|------|-------|
${architectureHealth.layerViolations.map((v) => `| \`${v.file}\` | ${v.message} |`).join("\n")}`
  : ""}

---

## 5. API Consistency

- **REST Conformance Score**: ${apiConsistency.restConformanceScore}/100
- **Issues**: ${apiConsistency.issues.length}
- **Duplicate endpoints**: ${apiConsistency.duplicateEndpoints.length}

${apiConsistency.duplicateEndpoints.length > 0
  ? `### Duplicate Endpoints
| Endpoint | Files |
|----------|-------|
${apiConsistency.duplicateEndpoints.map((d) => `| \`${d.path}\` | ${d.files.map((f) => `\`${f}\``).join(", ")} |`).join("\n")}`
  : ""}

${apiConsistency.issues.length > 0
  ? `<details>
<summary>API Issues (${apiConsistency.issues.length})</summary>

| Endpoint | Type | Message |
|----------|------|---------|
${apiConsistency.issues.slice(0, 30).map((i) => `| \`${i.endpoint}\` | ${i.type} | ${i.message} |`).join("\n")}

</details>`
  : ""}

---

## 6. Import Graph

- **Circular dependencies**: ${imports.circularDependencies.length}
- **High fan-out files**: ${imports.highFanOutFiles.length}
- **High fan-in files**: ${imports.highFanInFiles.length}

${imports.circularDependencies.length > 0
  ? `### Circular Dependencies
${imports.circularDependencies.slice(0, 10).map((c) => `- ${c.cycle.join(" -> ")}`).join("\n")}`
  : "No circular dependencies detected"}

${imports.highFanOutFiles.length > 0
  ? `### High Fan-Out (many imports)
| File | Import Count |
|------|-------------|
${imports.highFanOutFiles.slice(0, 10).map((f) => `| \`${f.file}\` | ${f.importCount} |`).join("\n")}`
  : ""}

---

## 7. Quality Metrics

| Metric | Value |
|--------|-------|
| Test files | ${quality.testFiles} |
| Source files | ${quality.sourceFiles} |
| Test ratio | ${(quality.testRatio * 100).toFixed(1)}% |
| \`any\` usage | ${quality.anyUsage} |
| TODO comments | ${quality.todoCount} |
| FIXME comments | ${quality.fixmeCount} |
| HACK comments | ${quality.hackCount} |
| console.log | ${quality.consoleLogCount} |
| try/catch blocks | ${quality.tryCatchCount} |
| Empty catch blocks | ${quality.emptyTryCatchCount} |
| Test assertions | ${quality.assertionCount} |
| Assertions/test file | ${quality.testFiles > 0 ? (quality.assertionCount / quality.testFiles).toFixed(1) : "N/A"} |

---

## 8. Test Coverage Details

**Overall test coverage ratio**: ${(testCoverage.overallCoverageRatio * 100).toFixed(1)}%

### Per-Feature Coverage
| Feature | Source Files | Test Files | Untested | Coverage |
|---------|------------|------------|----------|----------|
${testCoverage.details.map((d) => `| ${d.featureName} | ${d.sourceFiles.length} | ${d.testFiles.length} | ${d.untestedFiles.length} | ${(d.coverageRatio * 100).toFixed(0)}% |`).join("\n")}

### Critical Untested Files (large files without tests)
${testCoverage.untestedCriticalFiles.length > 0
  ? testCoverage.untestedCriticalFiles.map((f) => `- \`${f}\``).join("\n")
  : "All critical files have tests"}

---

## 9. Feature Completeness

| Area | Routes | Services | Components | Hooks | Models | Tests | Untested | Score |
|------|--------|----------|------------|-------|--------|-------|----------|-------|
${featureCompleteness.map((f) => `| ${f.name} | ${f.routes} | ${f.services} | ${f.components} | ${f.hooks} | ${f.models} | ${f.tests} | ${f.untestedSourceFiles.length} | **${f.score}/100** |`).join("\n")}

**Average feature coverage: ${scoring.featureCoverageScore}/100**

---

## 10. AI/Agent System

| Item | Value |
|------|-------|
| AI Providers | ${aiAgent.providers.join(", ") || "None"} |
| Agent Types | ${aiAgent.agentTypes.length > 0 ? aiAgent.agentTypes.join(", ") : "(dynamic)"} |
| Agent Routes | ${aiAgent.agentRoutes.length} |
| Agent Services | ${aiAgent.agentServices.length} |

---

## 11. Dependencies

| Package | Production | Dev | Total |
|---------|-----------|-----|-------|
| Backend | ${dependencies.backend.production} | ${dependencies.backend.dev} | ${dependencies.backend.total} |
| Frontend | ${dependencies.frontend.production} | ${dependencies.frontend.dev} | ${dependencies.frontend.total} |
| **Total** | **${dependencies.backend.production + dependencies.frontend.production}** | **${dependencies.backend.dev + dependencies.frontend.dev}** | **${dependencies.backend.total + dependencies.frontend.total}** |

---

## 12. Overall Assessment

### Scores
| Metric | Score |
|--------|-------|
| Overall | **${scoring.overallScore}/100** |
| Quality | ${scoring.qualityScore}/100 |
| Feature Coverage | ${scoring.featureCoverageScore}/100 |
| Architecture | ${scoring.architectureScore}/100 |
| Security | ${scoring.securityScore}/100 |

### Strengths
${scoring.strengths.length > 0 ? scoring.strengths.map((s) => `- ${s}`).join("\n") : "- None"}

### Weaknesses
${scoring.weaknesses.length > 0 ? scoring.weaknesses.map((w) => `- ${w}`).join("\n") : "- None"}

### Improvement Suggestions (Prioritized)
${scoring.suggestions.length > 0 ? scoring.suggestions.map((s) => `- ${s}`).join("\n") : "- None"}

---

## 13. AI Evaluation Prompt

Use the following prompt with \`analysis-result.json\` for detailed AI evaluation:

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
  log.info("Rapitas Codebase Analysis (Enhanced v2) - Starting...");
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

  log.info("Collecting complexity metrics...");
  const complexityMetrics = collectComplexityMetrics(files);

  log.info("Collecting security findings...");
  const securityFindings = collectSecurityFindings(files);

  log.info("Collecting import metrics...");
  const importMetrics = collectImportMetrics(files);

  log.info("Collecting API consistency...");
  const apiConsistency = collectAPIConsistency(architecture.backend.endpoints);

  log.info("Collecting test coverage details...");
  const testCoverage = collectTestCoverage(files, FEATURE_AREAS_CONFIG);

  log.info("Collecting architecture health...");
  const archHealth = collectArchitectureHealth(files, importMetrics);

  log.info("Collecting AI/agent metrics...");
  const aiAgent = collectAIAgentMetrics(files);

  log.info("Collecting dependency metrics...");
  const deps = collectDependencyMetrics();

  log.info("Collecting feature completeness...");
  const featureCompleteness = collectFeatureCompleteness(files, architecture);

  log.info("Computing scores...");
  const scoring = computeScoring(quality, featureCompleteness, architecture, codeMetrics, complexityMetrics, securityFindings, apiConsistency, archHealth);

  const executionTimeMs = Date.now() - startTime;

  const result: AnalysisResult = {
    metadata: {
      generatedAt: new Date().toISOString(),
      executionTimeMs,
      projectRoot: PROJECT_ROOT,
      version: "2.0.0",
    },
    codeMetrics,
    architecture,
    quality,
    complexity: complexityMetrics,
    security: securityFindings,
    imports: importMetrics,
    apiConsistency,
    testCoverage,
    architectureHealth: archHealth,
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
  log.info(`God objects: ${complexityMetrics.godObjects.length}`);
  log.info(`Security findings: ${securityFindings.findings.length} (high: ${securityFindings.summary.high})`);
  log.info(`Circular deps: ${importMetrics.circularDependencies.length}`);
  log.info(`Layer violations: ${archHealth.layerViolations.length}`);
  log.info(`Overall score: ${scoring.overallScore}/100`);
  log.info(`  Quality: ${scoring.qualityScore}/100`);
  log.info(`  Features: ${scoring.featureCoverageScore}/100`);
  log.info(`  Architecture: ${scoring.architectureScore}/100`);
  log.info(`  Security: ${scoring.securityScore}/100`);
  log.info(`Execution time: ${executionTimeMs}ms`);
}

main().catch((err) => {
  log.error({ err }, "Analysis failed");
  process.exit(1);
});
