/**
 * gen-type-guards
 *
 * Scans TypeScript source files for SSOT-pattern type definitions
 * (`export const UPPER_ARRAY = [...] as const` + `export type T = (typeof UPPER_ARRAY)[number]`)
 * and generates `is*` / `narrow*` type guard functions for types that lack them.
 *
 * Generated files are written adjacent to the source as `<basename>.guards.generated.ts`.
 * Existing handwritten guards are preserved — only the missing ones are generated.
 *
 * Usage:
 *   bun run gen:type-guards              # generate .guards.generated.ts files
 *   bun run gen:type-guards --check      # exit 1 if drift detected (generated ≠ on-disk)
 *   bun run gen:type-guards --warn-only  # exit 0 even if drift (warning only)
 *   bun run gen:type-guards --files a.ts b.ts          # process only specified files
 *   bun run gen:type-guards --check --files a.ts b.ts  # drift-check only specified files
 *
 * NOTE: Does NOT modify existing source files. All output is written to new .guards.generated.ts files.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { walkTs, relativeImportPath } from './codemods/lib/codemod-runner';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Directories to walk for SSOT pairs. */
const SCAN_ROOTS = [
  join(ROOT, 'services'),
  join(ROOT, 'routes'),
  join(ROOT, 'types'),
  join(ROOT, 'utils'),
];

/** Directory names excluded from scanning (extends codemod-runner defaults). */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__tests__',
  '.next',
  'generated',
  'prisma',
  'tests',
  'scripts',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One SSOT pair (array + derived type) with generation decision. */
export interface SsotPair {
  /** Runtime array constant name, e.g. `WORKFLOW_ROLES` */
  arrayName: string;
  /** Derived type name, e.g. `WorkflowRole` */
  typeName: string;
  /** Literal elements extracted from the array, e.g. `['researcher', 'planner']` */
  elements: string[];
  /** Default fallback for `narrow*`; first element unless `@gen-guard-fallback` overrides */
  fallback: string;
  /** Generate `is<T>` — false when the handwritten version already exists */
  generateIs: boolean;
  /** Generate `narrow<T>` — false when `narrow<T>` or `normalize<T>` already exists */
  generateNarrow: boolean;
}

/** A source file with at least one pair needing code generation. */
export interface SsotFile {
  filePath: string;
  outputPath: string;
  pairs: SsotPair[];
  /** Files/locations requiring manual attention (informational). */
  manualReview: string[];
}

/** Single entry in a drift check result. */
export interface DriftResult {
  file: string;
  status: 'missing' | 'mismatch';
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extracts quoted string literals from an array body.
 *
 * @param arrayContent - Text between `[` and `]` / 配列の中身テキスト
 * @returns String literal values / 文字列リテラル値
 */
export function parseArrayElements(arrayContent: string): string[] {
  return [...arrayContent.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/**
 * Returns the value from a `// @gen-guard-fallback: <value>` comment placed
 * anywhere in the file before the array declaration, or null if not found.
 *
 * @param content - Full file content / ファイル全体の内容
 * @param arrayName - SSOT array name to anchor the search / SSOT配列名
 * @returns Override fallback string, or null
 */
export function extractFallbackComment(content: string, arrayName: string): string | null {
  // Match comment that appears before (or inline near) the array declaration
  const re = new RegExp(
    `//\\s*@gen-guard-fallback:\\s*(\\S+)[\\s\\S]{0,500}?export const ${arrayName}`,
  );
  const m = re.exec(content);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Content pre-filter
// ---------------------------------------------------------------------------

/**
 * Fast pre-filter: checks whether a file's content could contain a SSOT pair
 * without running the full regex. Both substrings must be present for a file
 * to be a SSOT source.
 *
 * NOTE: Using AND of both patterns is intentionally conservative to avoid
 * false-negatives (missing a real SSOT file is worse than a redundant scan).
 *
 * @param content - Full file content / ファイル全体の内容
 * @returns True when the content may contain an SSOT pair / SSSOTペアを含む可能性がある場合true
 */
export function passesContentPrefilter(content: string): boolean {
  return content.includes('as const') && content.includes('[number]');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses `--files <path>...` from argv, returning the list of paths or
 * undefined when the flag is absent. Stops collecting at the next flag
 * (i.e. any argument starting with `-`).
 *
 * @param argv - Command-line arguments (e.g. process.argv) / コマンドライン引数
 * @returns Path list, or undefined when `--files` flag is absent / パスリスト、フラグ未指定時はundefined
 */
export function parseFilesArg(argv: string[]): string[] | undefined {
  const idx = argv.indexOf('--files');
  if (idx === -1) return undefined;

  const paths: string[] = [];
  for (let i = idx + 1; i < argv.length; i++) {
    if (argv[i].startsWith('-')) break; // next flag → stop collecting
    paths.push(argv[i]);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// SSOT pair extraction
// ---------------------------------------------------------------------------

// Multiline: export const UPPER = [ ... ] as const;
const SSOT_ARRAY_RE = /export const ([A-Z][A-Z0-9_]+) = \[([\s\S]*?)\] as const;/g;

// Derived type: export type T = (typeof UPPER)[number];
const DERIVED_TYPE_RE = /export type (\w+) = \(typeof ([A-Z][A-Z0-9_]+)\)\[number\];/g;

/**
 * Scans a TypeScript file and returns SSOT pairs where at least one guard is missing.
 * Pairs where all guards already exist are skipped silently.
 *
 * @param filePath - Absolute path to the TS file / TSファイルの絶対パス
 * @param content - File content / ファイル内容
 * @returns Pairs needing guard generation + manualReview notices
 */
export function extractSsotPairs(
  filePath: string,
  content: string,
): { pairs: SsotPair[]; manualReview: string[] } {
  const manualReview: string[] = [];

  // Collect all exported const arrays
  const arrays = new Map<string, string[]>();
  for (const m of content.matchAll(SSOT_ARRAY_RE)) {
    const arrayName = m[1];
    const elements = parseArrayElements(m[2]);
    if (elements.length === 0) {
      // NOTE: Empty SSOT array cannot produce a valid fallback value.
      manualReview.push(`${filePath} — ${arrayName}: empty array, skipped`);
      continue;
    }
    arrays.set(arrayName, elements);
  }

  // Collect derived types (arrayName → typeName)
  const derivedTypes = new Map<string, string>();
  for (const m of content.matchAll(DERIVED_TYPE_RE)) {
    const [, typeName, arrayName] = m;
    if (arrays.has(arrayName)) {
      derivedTypes.set(arrayName, typeName);
    } else {
      // Array exists somewhere else or uses a different pattern
      manualReview.push(
        `${filePath} — export type ${typeName} references ${arrayName} but array not found as \`export const\``,
      );
    }
  }

  // Flag SSOT arrays that have no matching derived type declaration
  for (const arrayName of arrays.keys()) {
    if (!derivedTypes.has(arrayName)) {
      manualReview.push(
        `${filePath} — ${arrayName}: no matching \`export type T = (typeof ${arrayName})[number]\` found; add one to enable guard generation`,
      );
    }
  }

  const pairs: SsotPair[] = [];
  for (const [arrayName, elements] of arrays) {
    const typeName = derivedTypes.get(arrayName);
    if (!typeName) continue;

    const isGuardRe = new RegExp(`(?:function|const)\\s+is${typeName}\\s*[=(]`);
    const narrowGuardRe = new RegExp(
      `(?:function|const)\\s+(?:narrow|normalize)${typeName}\\s*[=(]`,
    );

    const generateIs = !isGuardRe.test(content);
    const generateNarrow = !narrowGuardRe.test(content);

    if (!generateIs && !generateNarrow) continue; // All guards already exist

    const fallback = extractFallbackComment(content, arrayName) ?? elements[0];

    pairs.push({ arrayName, typeName, elements, fallback, generateIs, generateNarrow });
  }

  return { pairs, manualReview };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generates the TypeScript source for a `.guards.generated.ts` file.
 *
 * @param sourceFilePath - Absolute path to the SSOT source file
 * @param outputFilePath - Absolute path to the generated output file
 * @param pairs - SSOT pairs to generate guards for
 * @returns Complete TypeScript source string / 生成するTypeScriptソース文字列
 */
export function generateGuardSource(
  sourceFilePath: string,
  outputFilePath: string,
  pairs: SsotPair[],
): string {
  const sourceBasename = basename(sourceFilePath, extname(sourceFilePath));

  // NOTE: relativeImportPath requires the target without extension.
  const importPath = relativeImportPath(outputFilePath, sourceFilePath.replace(/\.ts$/, ''));

  const typeImports = pairs.map((p) => p.typeName);
  const valueImports = pairs.map((p) => p.arrayName);

  // When narrow* is generated but is* already exists in source, import it as a value.
  for (const p of pairs) {
    if (p.generateNarrow && !p.generateIs) {
      valueImports.push(`is${p.typeName}`);
    }
  }

  const blocks: string[] = [];

  // File header
  blocks.push(
    `/**\n` +
      ` * ${sourceBasename}.guards.generated\n` +
      ` *\n` +
      ` * 自動生成ファイル — 手動編集不可。再生成: \`bun run gen:type-guards\`\n` +
      ` * ソース: scripts/gen-type-guards.ts\n` +
      ` *\n` +
      ` * 命名規約:\n` +
      ` *   is*     — 型ガード: unknown 値が対象型かを boolean で返す\n` +
      ` *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す\n` +
      ` */`,
  );

  // Imports (type + value combined into one statement to keep it concise)
  blocks.push(
    `import type { ${typeImports.join(', ')} } from '${importPath}';\n` +
      `import { ${valueImports.join(', ')} } from '${importPath}';`,
  );

  // NOTE: isOneOf import is only needed when at least one is* guard is generated.
  if (pairs.some((p) => p.generateIs)) {
    const typeGuardsPath = relativeImportPath(
      outputFilePath,
      join(ROOT, 'utils', 'common', 'type-guards'),
    );
    blocks.push(`import { isOneOf } from '${typeGuardsPath}';`);
  }

  for (const p of pairs) {
    const { typeName, arrayName, fallback, generateIs, generateNarrow } = p;

    if (generateIs) {
      blocks.push(
        `/**\n` +
          ` * Type guard: narrows an unknown value to ${typeName}.\n` +
          ` *\n` +
          ` * @param s - Value to test. / 検査する値\n` +
          ` * @returns True when \`s\` is a valid ${typeName}. / 有効な${typeName}の場合true\n` +
          ` */\n` +
          `export function is${typeName}(s: unknown): s is ${typeName} {\n` +
          `  return isOneOf(s, ${arrayName});\n` +
          `}`,
      );
    }

    if (generateNarrow) {
      blocks.push(
        `/**\n` +
          ` * Narrows a DB string (or null/undefined) to ${typeName}, returning a fallback\n` +
          ` * when the value is absent or unrecognised.\n` +
          ` *\n` +
          ` * @param s - Raw value from the database. / DBからの生の値\n` +
          ` * @param fallback - Value to return when \`s\` is invalid. Defaults to \`'${fallback}'\`. / 無効時に返す値\n` +
          ` * @returns A valid ${typeName}. / 有効な${typeName}\n` +
          ` */\n` +
          `export function narrow${typeName}(\n` +
          `  s: string | null | undefined,\n` +
          `  fallback: ${typeName} = '${fallback}',\n` +
          `): ${typeName} {\n` +
          `  return is${typeName}(s) ? s : fallback;\n` +
          `}`,
      );
    }
  }

  return blocks.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Walks SCAN_ROOTS (or uses an explicit file list) and collects all source
 * files that have SSOT pairs needing guard generation.
 *
 * When `explicitFiles` is provided, only those files are scanned (useful for
 * incremental CI runs via `--files $(git diff --name-only ...)`). The default
 * behaviour (full scan) is preserved when the argument is omitted so that
 * drift detection remains comprehensive.
 *
 * @param explicitFiles - Optional list of absolute paths to scan instead of walking SCAN_ROOTS
 * @returns Array of SsotFile descriptors / SsotFileの配列
 */
export function scanForSsotFiles(explicitFiles?: string[]): SsotFile[] {
  const allFiles: string[] = [];

  if (explicitFiles !== undefined) {
    // NOTE: Filter .generated.ts files here too to match walkTs path behaviour.
    for (const f of explicitFiles) {
      if (!f.endsWith('.generated.ts')) allFiles.push(f);
    }
  } else {
    for (const root of SCAN_ROOTS) {
      const found = walkTs(root, ['.ts'], EXCLUDE_DIRS);
      // NOTE: Filter .generated.ts files to prevent self-re-scanning.
      allFiles.push(...found.filter((f) => !f.endsWith('.generated.ts')));
    }
  }

  const result: SsotFile[] = [];
  for (const filePath of allFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // NOTE: Pre-filter skips extractSsotPairs (regex matchAll) when neither
    // SSOT keyword is present, reducing CPU cost by ~97% across the scan roots.
    if (!passesContentPrefilter(content)) continue;

    const { pairs, manualReview } = extractSsotPairs(filePath, content);
    if (pairs.length === 0 && manualReview.length === 0) continue;

    const dir = dirname(filePath);
    const base = basename(filePath, extname(filePath));
    const outputPath = join(dir, `${base}.guards.generated.ts`);

    result.push({ filePath, outputPath, pairs, manualReview });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/**
 * Compares the expected generated content against what is on disk.
 *
 * @param explicitFiles - Optional list of absolute paths; when provided, only those files are checked
 * @returns Array of DriftResult for each out-of-sync file (empty = no drift)
 */
export function checkDrift(explicitFiles?: string[]): DriftResult[] {
  const ssotFiles = scanForSsotFiles(explicitFiles);
  const drifts: DriftResult[] = [];

  for (const { filePath, outputPath, pairs } of ssotFiles) {
    if (pairs.length === 0) continue; // Only manualReview notices — no generated file
    const expected = generateGuardSource(filePath, outputPath, pairs);

    if (!existsSync(outputPath)) {
      drifts.push({ file: outputPath, status: 'missing' });
      continue;
    }
    const actual = readFileSync(outputPath, 'utf-8');
    if (actual !== expected) {
      drifts.push({ file: outputPath, status: 'mismatch' });
    }
  }

  return drifts;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const CHECK_MODE = process.argv.includes('--check');
  const WARN_ONLY = process.argv.includes('--warn-only');
  const rawFiles = parseFilesArg(process.argv);

  // Resolve, validate, and filter the --files argument.
  let explicitFiles: string[] | undefined;
  if (rawFiles !== undefined) {
    explicitFiles = [];
    for (const raw of rawFiles) {
      const resolved = resolve(raw);
      if (!resolved.endsWith('.ts') || resolved.endsWith('.generated.ts')) {
        console.warn(`[gen-type-guards] --files: skipping non-TS or generated file: ${resolved}`);
        continue;
      }
      if (!existsSync(resolved)) {
        console.warn(`[gen-type-guards] --files: file not found, skipping: ${resolved}`);
        continue;
      }
      // NOTE: Files outside SCAN_ROOTS are allowed — caller's explicit intent takes priority.
      const inScanRoot = SCAN_ROOTS.some((root) => resolved.startsWith(root));
      if (!inScanRoot) {
        console.warn(
          `[gen-type-guards] --files: outside SCAN_ROOTS, processing anyway: ${resolved}`,
        );
      }
      explicitFiles.push(resolved);
    }
  }

  if (CHECK_MODE || WARN_ONLY) {
    const drifts = checkDrift(explicitFiles);
    if (drifts.length === 0) {
      console.log('gen-type-guards: no drift detected.');
      process.exit(0);
    } else {
      for (const d of drifts) {
        console.error(`DRIFT [${d.status}]: ${d.file}`);
      }
      console.error(
        `\nRun \`bun run gen:type-guards\` to regenerate and commit the updated files.`,
      );
      process.exit(WARN_ONLY ? 0 : 1);
    }
  } else {
    // Generate mode
    const ssotFiles = scanForSsotFiles(explicitFiles);
    let generated = 0;
    const allManualReview: string[] = [];

    for (const { filePath, outputPath, pairs, manualReview } of ssotFiles) {
      allManualReview.push(...manualReview);
      if (pairs.length === 0) continue;

      const content = generateGuardSource(filePath, outputPath, pairs);
      writeFileSync(outputPath, content, 'utf-8');
      console.log(`Generated: ${outputPath}`);
      generated++;
    }

    if (allManualReview.length > 0) {
      console.log('\n[gen-type-guards] Manual review required:');
      for (const note of allManualReview) {
        console.log(`  ${note}`);
      }
    }

    console.log(
      `\nDone — ${generated} file(s) generated. Commit the generated files to keep the repository in sync.`,
    );
  }
}
