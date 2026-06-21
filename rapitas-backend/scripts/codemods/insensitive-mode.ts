/**
 * codemod: insensitive-mode
 *
 * Replaces the Pattern A idiom:
 *   const isPostgres = process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && ...;
 *   const <varname> = isPostgres ? { mode: 'insensitive' as const } : {};
 * with a single call to `getInsensitiveMode()` from config/db-provider,
 * then adds the import if missing.
 *
 * Pattern B (`if (getDbProvider() === 'sqlite') { ... } return { ..., mode: 'insensitive' }`)
 * is detected and reported in manualReview but NOT automatically transformed —
 * the function-body restructure required is too complex for safe regex substitution.
 *
 * Scope: routes/ and services/ only.
 * Safety: defaults to dry-run. Pass `--write` to apply changes on disk.
 *
 * Usage:
 *   bun run scripts/codemods/insensitive-mode.ts             # dry-run
 *   bun run scripts/codemods/insensitive-mode.ts -- --write  # apply
 */

import { join } from 'path';
import {
  ensureImport,
  relativeImportPath,
  runCodemod,
  type TransformInput,
  type TransformResult,
} from './lib/codemod-runner';

const BACKEND_ROOT = join(import.meta.dir, '..', '..');
const DB_PROVIDER_MODULE = join(BACKEND_ROOT, 'config', 'db-provider');

// Pattern A: `const isPostgres = <multi-line expr>;` followed immediately by
// `const <varname> = isPostgres ? { mode: 'insensitive' as const } : {};`.
// Uses [\s\S]*? (dotall-like) to handle multi-line isPostgres declarations.
// Group 1: leading indent of the `const <varname>` line.
// Group 2: variable name (e.g. `insensitive`).
const PATTERN_A =
  /[ \t]*const isPostgres\s*=[\s\S]*?;\n([ \t]*)const (\w+)\s*=\s*isPostgres\s*\?\s*\{\s*mode:\s*'insensitive'\s+as\s+const\s*\}\s*:\s*\{\};/g;

// Pattern B detection: `if (getDbProvider() === 'sqlite')` within 500 chars of `mode: 'insensitive'`.
// These require manual migration — codemod emits manualReview entries only.
const PATTERN_B_DETECT =
  /if\s*\(\s*getDbProvider\(\)\s*===\s*['"]sqlite['"]\s*\)[\s\S]{0,500}?mode:\s*['"]insensitive['"]/g;

/**
 * Transforms a single file: replaces Pattern A with getInsensitiveMode() calls.
 * Detects Pattern B and adds entries to manualReview without modifying the file.
 *
 * @param input - File path and content / ファイルパスと内容
 * @returns Transform result with changed flag and manualReview entries / 変換結果
 */
export function transformInsensitiveMode(input: TransformInput): TransformResult {
  const { filePath, content } = input;
  const manualReview: string[] = [];

  // NOTE: Skip the definition file itself — it contains `mode: 'insensitive'` as the
  // return value of getInsensitiveMode() and must not be self-modified.
  if (filePath.replace(/\\/g, '/').endsWith('config/db-provider.ts')) {
    return { newContent: content, changed: false, manualReview };
  }

  // Pattern B detection: scan for getDbProvider() === 'sqlite' branches that
  // return a literal mode: 'insensitive'. Always run regardless of idempotent guard
  // so that already-partially-migrated files still surface Pattern B entries.
  PATTERN_B_DETECT.lastIndex = 0;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = PATTERN_B_DETECT.exec(content)) !== null) {
    const lineNumber = content.slice(0, bMatch.index).split('\n').length;
    manualReview.push(
      `${filePath}:${lineNumber} — Pattern B: getDbProvider() === 'sqlite' branch with mode: 'insensitive' (manual migration needed)`,
    );
  }

  // Idempotent guard: already uses getInsensitiveMode() — Pattern A already applied.
  if (content.includes('getInsensitiveMode(')) {
    return { newContent: content, changed: false, manualReview };
  }

  // Pattern A: replace both the isPostgres declaration and the ternary assignment.
  PATTERN_A.lastIndex = 0;
  if (!PATTERN_A.test(content)) {
    return { newContent: content, changed: false, manualReview };
  }
  PATTERN_A.lastIndex = 0;

  let changed = false;
  let newContent = content.replace(PATTERN_A, (_match, indent: string, varName: string) => {
    changed = true;
    return `${indent}const ${varName} = getInsensitiveMode();`;
  });

  if (changed) {
    const modulePath = relativeImportPath(filePath, DB_PROVIDER_MODULE);
    newContent = ensureImport(newContent, 'getInsensitiveMode', modulePath);
  }

  return { newContent, changed, manualReview };
}

if (import.meta.main) {
  const write = process.argv.includes('--write');
  runCodemod(transformInsensitiveMode, {
    roots: [join(BACKEND_ROOT, 'routes'), join(BACKEND_ROOT, 'services')],
    label: 'codemod:insensitive-mode',
    write,
  });
}
