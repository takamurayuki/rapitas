/**
 * gen-resolver-boundary-tests
 *
 * CLI entry point: scans `services/` for `*-resolver.ts` files and generates
 * `.boundary.test.ts` files asserting that edge inputs do not cause throws.
 *
 * Core analysis and code-generation logic lives in gen-resolver-boundary-tests-core.ts.
 *
 * Usage:
 *   bun run gen:boundary-tests              # generate .boundary.test.ts files
 *   bun run gen:boundary-tests --check      # exit 1 if drift detected
 *   bun run gen:boundary-tests --warn-only  # exit 0 even on drift (warning only)
 *   bun run gen:boundary-tests --files=a.ts,b.ts  # scan only specified files
 *
 * NOTE: Does NOT modify existing resolver source files.
 *       All output is written to new `.boundary.test.ts` files.
 * NOTE: Generated files must not be edited manually -- re-run this script instead.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { walkTs } from './codemods/lib/codemod-runner';
import {
  hasResolverCandidate,
  extractDbImportPath,
  detectNonStandardImports,
  extractResolverFunctions,
  extractModelUsage,
  generateBoundaryTestSource,
  type ScanOptions,
  type ResolverFile,
  type DriftResult,
} from './gen-resolver-boundary-tests-core';

// Re-export core primitives so callers can import from this single entry-point file.
export type {
  ExtractedFunction,
  ModelUsage,
  ScanOptions,
  ResolverFile,
  DriftResult,
} from './gen-resolver-boundary-tests-core';
export {
  hasResolverCandidate,
  extractDbImportPath,
  detectNonStandardImports,
  extractResolverFunctions,
  extractModelUsage,
  generateBoundaryTestSource,
} from './gen-resolver-boundary-tests-core';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Directories within ROOT to scan for resolver files. */
const SCAN_ROOTS = [join(ROOT, 'services')];

/** Directories to exclude from walking. */
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
// Scanning
// ---------------------------------------------------------------------------

/** CLI argument parser — same interface as gen-type-guards.ts. */
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

  const files: string[] = [];
  for (let i = idx + 1; i < argv.length; i++) {
    if (argv[i].startsWith('-')) break;
    files.push(argv[i]);
  }
  return files;
}

/**
 * Walks SCAN_ROOTS (or a caller-specified file list) and collects resolver files
 * that qualify for boundary test generation.
 *
 * Files are excluded when:
 *   - They are `.test.ts` or `.boundary.test.ts` files
 *   - They lack the quick-candidate markers (no prisma import or no resolve* fn)
 *   - They have non-standard imports (too complex for automated mocking)
 *   - They have no qualifying single-arg resolve* functions
 *
 * @param opts - Optional scan configuration / スキャン設定
 * @returns Array of ResolverFile descriptors / ResolverFileの配列
 */
export function scanForResolverFiles(opts?: ScanOptions): ResolverFile[] {
  // Empty file list = no resolver files in the changeset → nothing to scan.
  if (opts?.files !== undefined && opts.files.length === 0) {
    return [];
  }

  let allFiles: string[];

  if (opts?.files && opts.files.length > 0) {
    allFiles = opts.files
      .map((f) => (f.startsWith('/') || /^[A-Za-z]:/.test(f) ? f : resolve(ROOT, f)))
      .filter(
        (f) => f.endsWith('.ts') && !f.endsWith('.boundary.test.ts') && !f.endsWith('.test.ts'),
      );
  } else {
    allFiles = [];
    for (const root of SCAN_ROOTS) {
      const found = walkTs(root, ['.ts'], EXCLUDE_DIRS);
      allFiles.push(
        ...found.filter((f) => !f.endsWith('.boundary.test.ts') && !f.endsWith('.test.ts')),
      );
    }
  }

  const result: ResolverFile[] = [];

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Quick pre-filter.
    if (!hasResolverCandidate(content)) continue;

    const dbImportPath = extractDbImportPath(content);
    if (!dbImportPath) continue;

    const nonStandard = detectNonStandardImports(content);
    const manualReview: string[] = [];

    if (nonStandard.length > 0) {
      manualReview.push(
        `${filePath} — non-standard imports detected: ${nonStandard.join(', ')}; boundary tests must be written manually`,
      );
      // Still collect functions for manualReview reporting, but don't generate.
      const { manualReview: fnReview } = extractResolverFunctions(filePath, content);
      manualReview.push(...fnReview);
      const dir = dirname(filePath);
      const base = basename(filePath, extname(filePath));
      result.push({
        filePath,
        outputPath: join(dir, `${base}.boundary.test.ts`),
        dbImportPath,
        functions: [],
        models: [],
        manualReview,
      });
      continue;
    }

    const { functions, manualReview: fnManual } = extractResolverFunctions(filePath, content);
    manualReview.push(...fnManual);

    if (functions.length === 0) {
      if (manualReview.length > 0) {
        const dir = dirname(filePath);
        const base = basename(filePath, extname(filePath));
        result.push({
          filePath,
          outputPath: join(dir, `${base}.boundary.test.ts`),
          dbImportPath,
          functions: [],
          models: [],
          manualReview,
        });
      }
      continue;
    }

    const models = extractModelUsage(content);
    const dir = dirname(filePath);
    const base = basename(filePath, extname(filePath));
    const outputPath = join(dir, `${base}.boundary.test.ts`);

    result.push({ filePath, outputPath, dbImportPath, functions, models, manualReview });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/**
 * Compares the expected generated content against what is on disk.
 *
 * @param opts - Optional scan configuration / スキャン設定
 * @returns Array of DriftResult for each out-of-sync file (empty = no drift)
 */
export function checkDrift(opts?: ScanOptions): DriftResult[] {
  const resolverFiles = scanForResolverFiles(opts);
  const drifts: DriftResult[] = [];

  for (const { filePath, outputPath, functions, models, dbImportPath } of resolverFiles) {
    if (functions.length === 0) continue;

    const expected = generateBoundaryTestSource(
      filePath,
      outputPath,
      functions,
      models,
      dbImportPath,
    );

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
      console.log('gen-resolver-boundary-tests: no drift detected.');
      process.exit(0);
    } else {
      for (const d of drifts) {
        console.error(`DRIFT [${d.status}]: ${d.file}`);
      }
      console.error(
        `\nRun \`bun run gen:boundary-tests\` to regenerate and commit the updated files.`,
      );
      process.exit(WARN_ONLY ? 0 : 1);
    }
  } else {
    // Generate mode
    const resolverFiles = scanForResolverFiles(scanOpts);
    let generated = 0;
    const allManualReview: string[] = [];

    for (const {
      filePath,
      outputPath,
      functions,
      models,
      dbImportPath,
      manualReview,
    } of resolverFiles) {
      allManualReview.push(...manualReview);
      if (functions.length === 0) continue;

      const content = generateBoundaryTestSource(
        filePath,
        outputPath,
        functions,
        models,
        dbImportPath,
      );
      writeFileSync(outputPath, content, 'utf-8');
      console.log(`Generated: ${outputPath}`);
      generated++;
    }

    if (allManualReview.length > 0) {
      console.log('\n[gen-resolver-boundary-tests] Manual review required:');
      for (const note of allManualReview) {
        console.log(`  ${note}`);
      }
    }

    console.log(
      `\nDone -- ${generated} file(s) generated. Commit the generated files to keep the repository in sync.`,
    );
  }
}
