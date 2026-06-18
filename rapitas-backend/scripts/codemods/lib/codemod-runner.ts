/**
 * codemod-runner
 *
 * Shared infrastructure for all codemod scripts: TypeScript file walking,
 * import-dedup utilities, dry-run/write split, and summary reporting.
 * Does NOT perform any code transformation itself — each codemod supplies
 * a `transform` callback.
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/** Relative path + original content to transform. */
export interface TransformInput {
  /** Absolute path of the file. */
  filePath: string;
  /** Current file content. */
  content: string;
}

/** Result returned by a transform callback. */
export interface TransformResult {
  /** Modified content. If unchanged, set equal to input content (or pass `changed: false`). */
  newContent: string;
  /** Whether the content actually changed. */
  changed: boolean;
  /**
   * File-and-line references that require manual attention.
   * E.g. `"src/routes/foo.ts:42 — extra fields detected"`.
   */
  manualReview: string[];
}

/** Options for runCodemod. */
export interface CodemodOptions {
  /** Glob-style root directories to walk (absolute paths). */
  roots: string[];
  /** File extensions to include (default: ['.ts']). */
  extensions?: string[];
  /** Directories to skip relative to any root (default: standard excludes). */
  excludeDirs?: string[];
  /** When true, write transformed content back to disk. Default: false (dry-run). */
  write?: boolean;
  /** Label shown in summary output. */
  label: string;
}

/** Summary printed after a codemod run. */
export interface CodemodSummary {
  changed: number;
  unchanged: number;
  manualReview: string[];
}

const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__tests__',
  '.next',
  'generated',
  'prisma',
  'tests',
]);

/**
 * Walks a directory tree and collects `.ts` files, excluding common non-source dirs.
 *
 * @param root - Absolute path to start walking / 走査を開始する絶対パス
 * @param extensions - File extensions to include / 対象ファイル拡張子
 * @param excludeDirs - Directory names to skip / スキップするディレクトリ名
 * @returns Array of absolute file paths / 絶対パスの配列
 */
export function walkTs(
  root: string,
  extensions: string[] = ['.ts'],
  excludeDirs: Set<string> = DEFAULT_EXCLUDE_DIRS,
): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (excludeDirs.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && extensions.some((ext) => name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  if (existsSync(root)) walk(root);
  return results;
}

/**
 * Ensures a named export is imported from a given module path, adding a new
 * import statement at the end of the import block if the symbol is absent.
 * Safe to call multiple times — idempotent.
 *
 * @param content - Source file content / ソースファイル内容
 * @param symbol - Named export to import (e.g. `parseSpecArray`) / インポートするシンボル
 * @param modulePath - Module specifier (e.g. `'../../utils/common/spec-array'`) / モジュールパス
 * @returns Modified content / 変更後の内容
 */
export function ensureImport(content: string, symbol: string, modulePath: string): string {
  // Already imported — check if the symbol is imported in ANY import line (path may differ).
  // NOTE: We check the symbol name only, not the module path, to handle cases where the
  // relative path differs (e.g. '../utils/foo' vs '../../utils/foo' for different depths).
  const lines = content.split('\n');
  const alreadyImported = lines.some(
    (line) =>
      line.trimStart().startsWith('import ') &&
      // Matches: import { symbol } or import { x, symbol } or import { symbol, x }
      new RegExp(`\\{[^}]*\\b${symbol}\\b[^}]*\\}`).test(line),
  );
  if (alreadyImported) return content;

  // Find last import line index.
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('import ')) lastImportIdx = i;
  }

  const newImport = `import { ${symbol} } from '${modulePath}';`;
  if (lastImportIdx === -1) {
    // No imports at all — prepend.
    return newImport + '\n' + content;
  }
  // Insert after last import line.
  lines.splice(lastImportIdx + 1, 0, newImport);
  return lines.join('\n');
}

/**
 * Computes the relative import path from a source file to a target module,
 * suitable for use in an import statement.
 *
 * @param fromFile - Absolute path of the source file / ソースファイルの絶対パス
 * @param toFile - Absolute path of the target module (without extension) / ターゲットモジュールの絶対パス
 * @returns Relative import specifier (e.g. `../../utils/common/response`) / 相対インポートパス
 */
export function relativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split(sep).slice(0, -1).join(sep);
  let rel = relative(fromDir, toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

/**
 * Runs a codemod over a set of TypeScript files.
 * Prints a summary to stdout and returns it.
 *
 * @param transform - Function that transforms a single file's content / 変換関数
 * @param options - Codemod options / オプション
 * @returns Summary of the run / 実行サマリー
 */
export function runCodemod(
  transform: (input: TransformInput) => TransformResult,
  options: CodemodOptions,
): CodemodSummary {
  const { roots, extensions = ['.ts'], excludeDirs, write = false, label } = options;

  const excludeSet = excludeDirs ? new Set(excludeDirs) : DEFAULT_EXCLUDE_DIRS;

  const files: string[] = [];
  for (const root of roots) {
    files.push(...walkTs(root, extensions, excludeSet));
  }

  let changed = 0;
  let unchanged = 0;
  const manualReview: string[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      unchanged++;
      continue;
    }

    const result = transform({ filePath, content });
    manualReview.push(...result.manualReview);

    if (result.changed) {
      changed++;
      if (write) {
        writeFileSync(filePath, result.newContent, 'utf-8');
        console.log(`[${label}] ✏️  ${filePath}`);
      } else {
        console.log(`[${label}] would change: ${filePath}`);
      }
    } else {
      unchanged++;
    }
  }

  const mode = write ? 'write' : 'dry-run';
  console.log(
    `\n[${label}] ${mode} — changed: ${changed} / unchanged: ${unchanged} / manual-review: ${manualReview.length}`,
  );
  if (manualReview.length > 0) {
    console.log(`[${label}] Manual review required:`);
    for (const ref of manualReview) {
      console.log(`  ${ref}`);
    }
  }

  return { changed, unchanged, manualReview };
}
