/**
 * gen-resolver-boundary-tests-core
 *
 * Core analysis and code-generation primitives for the boundary-value test
 * scaffolding generator. Provides resolver scanning, function extraction, and
 * test-source generation. The CLI entry point lives in gen-resolver-boundary-tests.ts.
 *
 * NOTE: This file is split from gen-resolver-boundary-tests.ts to stay within
 *       the 500-line file-size limit (COMPONENT_SPLITTING_POLICY.md).
 */

import { join, dirname, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { relativeImportPath } from './codemods/lib/codemod-runner';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Absolute path to the boundary-values helper (without .ts extension). */
export const BOUNDARY_VALUES_PATH = join(ROOT, 'tests', 'helpers', 'boundary-values');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single extracted resolver function ready for boundary test generation. */
export interface ExtractedFunction {
  /** e.g. `resolveTaskWithTheme` */
  name: string;
  /** e.g. `taskId` */
  paramName: string;
  /** Parameter type: `number`, `string`, or `number | null` */
  paramType: 'number' | 'string' | 'number | null';
}

/** A prisma model and the find* methods it uses in the resolver source. */
export interface ModelUsage {
  /** e.g. `task`, `user`, `agentSession` */
  modelName: string;
  /** find methods in use: `findFirst`, `findUnique`, `findMany` */
  methods: string[];
}

/** Scan options shared with checkDrift. */
export interface ScanOptions {
  /**
   * When provided, only these files are scanned.
   * Paths may be absolute or relative to ROOT.
   */
  files?: string[];
}

/** A resolver file ready for boundary test generation. */
export interface ResolverFile {
  /** Absolute path to the source resolver file. */
  filePath: string;
  /** Absolute path to the generated `.boundary.test.ts` file. */
  outputPath: string;
  /** The path string used in `import ... from '...'` for prisma (e.g. `../../config/database`). */
  dbImportPath: string;
  /** Extracted resolver functions to test. */
  functions: ExtractedFunction[];
  /** Detected prisma model usages for mock generation. */
  models: ModelUsage[];
  /** Informational items requiring human attention. */
  manualReview: string[];
}

/** Single entry in a drift check result. */
export interface DriftResult {
  file: string;
  status: 'missing' | 'mismatch';
}

// ---------------------------------------------------------------------------
// Quick pre-filter
// ---------------------------------------------------------------------------

// NOTE: Files lacking both of these substrings have no resolver candidates.
const PRISMA_IMPORT_SUBSTR = 'config/database';
const RESOLVER_FN_SUBSTR = 'export async function resolve';

/**
 * Returns true when the file content may contain a qualifying resolver function.
 * Used as a fast pre-filter before the full regex scan runs.
 *
 * @param content - Full file content / ファイル全体の内容
 * @returns True when the file warrants a full scan / 完全スキャンが必要な場合true
 */
export function hasResolverCandidate(content: string): boolean {
  return content.includes(PRISMA_IMPORT_SUBSTR) && content.includes(RESOLVER_FN_SUBSTR);
}

// ---------------------------------------------------------------------------
// Import analysis
// ---------------------------------------------------------------------------

/** Regex to extract the import path from `import { prisma } from '...'`. */
const DB_IMPORT_RE = /import\s+\{[^}]*\bprisma\b[^}]*\}\s+from\s+['"]([^'"]+)['"]/;

/**
 * Extracts the relative import path used for prisma in the source file.
 * Returns null when the prisma import is not found.
 *
 * @param content - Source file content / ソースファイル内容
 * @returns Import path string e.g. `../../config/database`, or null
 */
export function extractDbImportPath(content: string): string | null {
  const m = DB_IMPORT_RE.exec(content);
  return m ? m[1] : null;
}

/**
 * Returns all non-type import module paths that are NOT from the allowlist:
 * `@prisma/client`, paths containing `config/database`, `config/logger`.
 *
 * Files with any non-standard imports are too complex for automated boundary test
 * generation and should be flagged for manualReview.
 *
 * @param content - Source file content / ソースファイル内容
 * @returns Array of non-standard import module paths / 非標準インポートのモジュールパス配列
 */
export function detectNonStandardImports(content: string): string[] {
  // NOTE: Matches `import { ... } from '...'` or `import Name from '...'` (non-type).
  //       Multi-line imports work because `[^}]+` matches newlines.
  const IMPORT_RE =
    /^import\s+(?!type\s)(?:\{[^}]+\}|\w+(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/gm;
  const ALLOWED = /(@prisma\/client|\/config\/database|\/config\/logger)/;
  const nonStandard: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const modulePath = m[1];
    if (!ALLOWED.test(modulePath)) {
      nonStandard.push(modulePath);
    }
  }
  return nonStandard;
}

// ---------------------------------------------------------------------------
// Function extraction
// ---------------------------------------------------------------------------

// NOTE: Matches both single-line and multi-line function signatures.
//       `([^)]*)` spans newlines because `[^)]` matches any char except `)`.
const RESOLVER_FN_RE = /export async function (resolve\w+)\(([^)]*)\)/g;

// NOTE: Accepts trailing comma from multi-line param formatting: `param: type,`
const SINGLE_PARAM_RE = /^(\w+)\s*:\s*(number|string)(\s*\|\s*null)?\s*,?\s*$/;

/**
 * Extracts resolver functions with a single qualifying parameter.
 * Multi-arg or unsupported-type functions are added to manualReview.
 *
 * @param filePath - Absolute path (used in manualReview messages) / ファイルパス
 * @param content - Source file content / ソースファイル内容
 * @returns Extracted functions + manualReview notices
 */
export function extractResolverFunctions(
  filePath: string,
  content: string,
): { functions: ExtractedFunction[]; manualReview: string[] } {
  const functions: ExtractedFunction[] = [];
  const manualReview: string[] = [];

  RESOLVER_FN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RESOLVER_FN_RE.exec(content)) !== null) {
    const [, fnName, rawParams] = m;

    // Split by comma and trim; filter empty parts from trailing comma.
    const params = rawParams
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (params.length !== 1) {
      manualReview.push(
        `${filePath}:${fnName} — ${params.length} params (expected 1); add test manually`,
      );
      continue;
    }

    const paramMatch = SINGLE_PARAM_RE.exec(params[0]);
    if (!paramMatch) {
      manualReview.push(
        `${filePath}:${fnName} — unsupported param type "${params[0]}"; add test manually`,
      );
      continue;
    }

    const [, paramName, baseType, nullPart] = paramMatch;
    const paramType =
      nullPart !== undefined ? ('number | null' as const) : (baseType as 'number' | 'string');

    functions.push({ name: fnName, paramName, paramType });
  }

  return { functions, manualReview };
}

// ---------------------------------------------------------------------------
// Prisma model detection
// ---------------------------------------------------------------------------

// NOTE: Allow optional whitespace including newlines between model name and method.
//       Many resolvers use multi-line format: `prisma.task\n  .findUnique(`.
const PRISMA_MODEL_RE = /\bprisma\.(\w+)\s*\.\s*(findFirst|findUnique|findMany)\s*\(/g;

/**
 * Extracts all prisma model usages from the source file content.
 * Used to generate the correct mock declarations in the test file.
 *
 * @param content - Source file content / ソースファイル内容
 * @returns Deduplicated model usages / 重複排除したモデル使用一覧
 */
export function extractModelUsage(content: string): ModelUsage[] {
  const modelMap = new Map<string, Set<string>>();

  PRISMA_MODEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRISMA_MODEL_RE.exec(content)) !== null) {
    const [, modelName, method] = m;
    if (!modelMap.has(modelName)) {
      modelMap.set(modelName, new Set());
    }
    modelMap.get(modelName)!.add(method);
  }

  return [...modelMap.entries()].map(([modelName, methods]) => ({
    modelName,
    methods: [...methods].sort(),
  }));
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/** Converts `camelCase` model names to PascalCase for mock variable names. */
function toPascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Returns the mock variable name for a model+method pair. */
function mockVarName(modelName: string, method: string): string {
  return `mock${toPascal(modelName)}${toPascal(method)}`;
}

/** Returns the EDGES constant name for a given param type. */
function edgesConstName(paramType: ExtractedFunction['paramType']): string {
  if (paramType === 'string') return 'STRING_EDGES';
  if (paramType === 'number | null') return 'NULLABLE_ID_EDGES';
  return 'ID_EDGES';
}

/** Returns the TypeScript cast needed for test.each mapped value array of a given edge type. */
function edgeTypeCast(paramType: ExtractedFunction['paramType']): string {
  if (paramType === 'number | null') return ' as (number | null)[]';
  return '';
}

/**
 * Generates the TypeScript source for a `.boundary.test.ts` file.
 *
 * @param sourceFilePath - Absolute path to the resolver source / リゾルバソースの絶対パス
 * @param outputFilePath - Absolute path to the generated test file / 生成テストファイルの絶対パス
 * @param functions - Extracted resolver functions / 抽出されたリゾルバ関数
 * @param models - Detected prisma model usages / 検出されたPrismaモデル使用
 * @param dbImportPath - Import path string used in source for prisma / ソースでのprismaインポートパス
 * @returns Complete TypeScript test source / 生成するTypeScriptテストソース
 */
export function generateBoundaryTestSource(
  sourceFilePath: string,
  outputFilePath: string,
  functions: ExtractedFunction[],
  models: ModelUsage[],
  dbImportPath: string,
): string {
  const sourceBasename = basename(sourceFilePath, extname(sourceFilePath));
  // Import path from the generated test file to the resolver source (adjacent file).
  const resolverImportPath = `./${sourceBasename}`;
  // Relative import path from test file to boundary-values helper.
  const boundaryValuesPath = relativeImportPath(outputFilePath, BOUNDARY_VALUES_PATH);

  // Determine which EDGES constants are needed.
  const neededEdges = new Set(functions.map((f) => edgesConstName(f.paramType)));
  const edgesImport = [...neededEdges].sort().join(', ');

  // Generate mock variable declarations for each model+method.
  const allMockVars: { varName: string; modelName: string; method: string }[] = [];
  for (const { modelName, methods } of models) {
    for (const method of methods) {
      allMockVars.push({ varName: mockVarName(modelName, method), modelName, method });
    }
  }

  const blocks: string[] = [];

  // --- File header ---
  blocks.push(
    `/**\n` +
      ` * ${sourceBasename}.boundary.test\n` +
      ` *\n` +
      ` * 自動生成ファイル — 手動編集不可。再生成: \`bun run gen:boundary-tests\`\n` +
      ` * ソース: scripts/gen-resolver-boundary-tests.ts\n` +
      ` *\n` +
      ` * 境界値テストの契約: 全対象関数は edge 入力で reject せず、null を返すこと。\n` +
      ` */`,
  );

  // --- Imports ---
  blocks.push(
    `import { describe, test, expect, mock, beforeEach } from 'bun:test';\n` +
      `import { ${edgesImport} } from '${boundaryValuesPath}';`,
  );

  // --- Mock variable declarations ---
  if (allMockVars.length > 0) {
    const varDecls = allMockVars
      .map(
        ({ varName }) =>
          `const ${varName} = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;`,
      )
      .join('\n');
    // NOTE: bun:test の mock.module はプロセスグローバルなため、全エクスポートをミラーしないとバレルが "export not found" をスローする。
    blocks.push(
      `// HACK(agent): bun:test の mock.module はプロセスグローバルなため、\n` +
        `// 全エクスポートをミラーしないとバレルが "export not found" をスローする。\n` +
        varDecls,
    );
  }

  // --- mock.module for database ---
  const prismaModelShape = models
    .map(({ modelName, methods }) => {
      const methodEntries = methods
        .map((method) => `${method}: ${mockVarName(modelName, method)}`)
        .join(', ');
      return `    ${modelName}: { ${methodEntries} }`;
    })
    .join(',\n');

  const prismaShapeBody = prismaModelShape ? `\n${prismaModelShape},\n  ` : '';
  blocks.push(
    `mock.module('${dbImportPath}', () => ({\n` +
      `  prisma: {${prismaShapeBody}},\n` +
      `  ensureDatabaseConnection: () => Promise.resolve(),\n` +
      `}));`,
  );

  // --- mock.module for logger (always include for safety) ---
  const loggerImportPath = dbImportPath.replace(/\/config\/database.*$/, '/config/logger');
  // NOTE: Object literals are expanded to multi-line format to match Prettier output.
  blocks.push(
    `mock.module('${loggerImportPath}', () => {\n` +
      `  const noopLogger = {\n` +
      `    info: () => {},\n` +
      `    error: () => {},\n` +
      `    warn: () => {},\n` +
      `    debug: () => {},\n` +
      `    fatal: () => {},\n` +
      `  };\n` +
      `  return {\n` +
      `    createLogger: () => noopLogger,\n` +
      `    logger: noopLogger,\n` +
      `    getBackendLogFilePath: () => '/tmp/backend.log',\n` +
      `  };\n` +
      `});`,
  );

  // --- Resolver import ---
  // NOTE: Multi-name destructuring is expanded to multi-line to stay within Prettier's 80-char limit.
  const fnNameList = functions.map((f) => f.name);
  const resolverImportLine =
    fnNameList.length > 1
      ? `const {\n  ${fnNameList.join(',\n  ')},\n} = await import('${resolverImportPath}');`
      : `const { ${fnNameList[0]} } = await import('${resolverImportPath}');`;
  blocks.push(resolverImportLine);

  // --- beforeEach reset ---
  if (allMockVars.length > 0) {
    const resets = allMockVars
      .map(({ varName }) => `  ${varName}.mockReset();\n` + `  ${varName}.mockResolvedValue(null);`)
      .join('\n');
    blocks.push(`beforeEach(() => {\n${resets}\n});`);
  }

  // --- Test cases per function ---
  for (const fn of functions) {
    const edges = edgesConstName(fn.paramType);
    const typeCast = edgeTypeCast(fn.paramType);
    const rejectSetup = allMockVars
      .map(({ varName }) => `      ${varName}.mockRejectedValueOnce(new Error('DB error'));`)
      .join('\n');

    blocks.push(
      `// ---------------------------------------------------------------------------\n` +
        `// ${fn.name} 境界値テスト\n` +
        `// ---------------------------------------------------------------------------\n` +
        `describe('${fn.name} 境界値テスト', () => {\n` +
        `  test.each(${edges}.map((bc) => bc.value)${typeCast})(\n` +
        `    'prisma が null を返すとき %p は null を返すこと',\n` +
        `    async (edge) => {\n` +
        `      const result = await ${fn.name}(edge${fn.paramType === 'number | null' ? ' as number | null' : ''});\n` +
        `      expect(result).toBeNull();\n` +
        `    },\n` +
        `  );\n` +
        `\n` +
        `  test.each(${edges}.map((bc) => bc.value)${typeCast})(\n` +
        `    'prisma が reject するとき %p でも null を返すこと',\n` +
        `    async (edge) => {\n` +
        `${rejectSetup}\n` +
        `      const result = await ${fn.name}(edge${fn.paramType === 'number | null' ? ' as number | null' : ''});\n` +
        `      expect(result).toBeNull();\n` +
        `    },\n` +
        `  );\n` +
        `});`,
    );
  }

  return blocks.join('\n\n') + '\n';
}
