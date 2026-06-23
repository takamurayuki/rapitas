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
 *   bun run gen:type-guards --files=a.ts,b.ts          # scan only specified files
 *   bun run gen:type-guards --check --files=a.ts,b.ts  # check drift in specified files only
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

/** Options for scanForSsotFiles / checkDrift. */
export interface ScanOptions {
  /**
   * When provided, only these files are scanned instead of walking SCAN_ROOTS.
   * Paths may be absolute or relative to ROOT (the rapitas-backend directory).
   * Non-.ts files and .generated.ts files are silently skipped.
   */
  files?: string[];
}

// ---------------------------------------------------------------------------
// Quick pre-filter
// ---------------------------------------------------------------------------

// NOTE: Matches '] as const;' which all SSOT arrays end with. Files lacking this
// substring are guaranteed to have no SSOT pairs and can be skipped before
// the more expensive multiline regex matching runs (saves ~92% of file reads).
const SSOT_QUICK_CHECK_RE = /\] as const;/;

/**
 * Returns true when the file content may contain an SSOT array pattern.
 * Used as a fast pre-filter before the full multiline regex scan.
 *
 * @param content - Full file content / ファイル全体の内容
 * @returns True when the file is worth fully scanning / 完全スキャンが必要な場合true
 */
export function hasSsotCandidate(content: string): boolean {
  return SSOT_QUICK_CHECK_RE.test(content);
}

// ---------------------------------------------------------------------------
// CLI argument helpers
// ---------------------------------------------------------------------------

/**
 * Parses the `--files` CLI argument into an array of file paths.
 *
 * Supported forms:
 *   --files=foo.ts,bar.ts   → ['foo.ts', 'bar.ts']
 *   --files foo.ts bar.ts   → ['foo.ts', 'bar.ts'] (stops at next flag)
 *   (absent)                → null (full SCAN_ROOTS walk)
 *
 * @param argv - process.argv / コマンドライン引数配列
 * @returns Parsed file paths, or null when --files is absent
 */
export function parseFilesArg(argv: string[]): string[] | null {
  const idx = argv.findIndex((a) => a === '--files' || a.startsWith('--files='));
  if (idx === -1) return null;

  const arg = argv[idx];
  if (arg.startsWith('--files=')) {
    const val = arg.slice('--files='.length);
    return val
      ? val
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : [];
  }

  // '--files' with space-separated values: consume remaining non-flag args
  const files: string[] = [];
  for (let i = idx + 1; i < argv.length; i++) {
    if (argv[i].startsWith('-')) break;
    files.push(argv[i]);
  }
  return files;
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
 * Walks SCAN_ROOTS (or a caller-specified file list) and collects source files
 * that have SSOT pairs needing guard generation.
 *
 * When `opts.files` is provided, only those files are scanned — SCAN_ROOTS walk
 * is skipped entirely. This is the primary optimization for incremental CI: pass
 * only the files changed in the current PR (`git diff --name-only | grep '\.ts$'`).
 *
 * @param opts - Optional scan configuration / オプションのスキャン設定
 * @returns Array of SsotFile descriptors / SsotFileの配列
 */
export function scanForSsotFiles(opts?: ScanOptions): SsotFile[] {
  let allFiles: string[];

  if (opts?.files && opts.files.length > 0) {
    // Incremental mode: scan only the specified files.
    allFiles = opts.files
      .map((f) => (f.startsWith('/') || /^[A-Za-z]:/.test(f) ? f : resolve(ROOT, f)))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.generated.ts'));
  } else {
    // Full-scan mode: walk all SCAN_ROOTS.
    allFiles = [];
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

    // Quick pre-filter: skip files without SSOT pattern candidates (~92% of files).
    if (!hasSsotCandidate(content)) continue;

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
 * Accepts the same ScanOptions as scanForSsotFiles to support incremental CI checks.
 *
 * @param opts - Optional scan configuration / オプションのスキャン設定
 * @returns Array of DriftResult for each out-of-sync file (empty = no drift)
 */
export function checkDrift(opts?: ScanOptions): DriftResult[] {
  const ssotFiles = scanForSsotFiles(opts);
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
  const filesArg = parseFilesArg(process.argv);
  const scanOpts: ScanOptions = filesArg !== null ? { files: filesArg } : {};

  if (CHECK_MODE || WARN_ONLY) {
    const drifts = checkDrift(scanOpts);
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
    const ssotFiles = scanForSsotFiles(scanOpts);
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
