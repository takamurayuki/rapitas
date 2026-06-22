/**
 * codemod: spec-array
 *
 * Replaces `JSON.parse(x || '[]')` and `JSON.parse(x ?? '[]')` patterns with
 * `parseSpecArray(x)` from utils/common/spec-array, then adds the import if missing.
 *
 * Scope: services/ only (the helper is relevant to DB-layer array columns).
 * Safety: defaults to dry-run. Pass `--write` to apply changes on disk.
 *
 * Usage:
 *   bun run scripts/codemods/spec-array.ts             # dry-run
 *   bun run scripts/codemods/spec-array.ts -- --write  # apply
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
const SPEC_ARRAY_MODULE = join(BACKEND_ROOT, 'utils', 'common', 'spec-array');

// Pattern: JSON.parse(expr || '[]') or JSON.parse(expr ?? '[]')
// Groups: [1] = the expression before || / ??
const SPEC_ARRAY_PATTERN =
  /JSON\.parse\(\s*((?:[^()]+|\([^)]*\))+?)\s*(?:\|\||\?\?)\s*'?\[\]'?\s*\)(\s*as\s+string\[\])?/g;

/**
 * Transforms a single file: replaces JSON.parse spec-array patterns with parseSpecArray.
 *
 * @param input - File path and content / ファイルパスと内容
 * @returns Transform result / 変換結果
 */
export function transformSpecArray(input: TransformInput): TransformResult {
  const { filePath, content } = input;
  const manualReview: string[] = [];

  // Already uses parseSpecArray — skip to stay idempotent.
  if (!SPEC_ARRAY_PATTERN.test(content)) {
    return { newContent: content, changed: false, manualReview };
  }
  // Reset regex lastIndex after test().
  SPEC_ARRAY_PATTERN.lastIndex = 0;

  let changed = false;
  let newContent = content.replace(SPEC_ARRAY_PATTERN, (_match, expr: string) => {
    const trimmed = expr.trim();
    changed = true;
    // Remove trailing cast annotation in the replacement (parseSpecArray already returns string[]).
    return `parseSpecArray(${trimmed})`;
  });

  if (changed) {
    const modulePath = relativeImportPath(filePath, SPEC_ARRAY_MODULE);
    newContent = ensureImport(newContent, 'parseSpecArray', modulePath);
  }

  return { newContent, changed, manualReview };
}

if (import.meta.main) {
  const write = process.argv.includes('--write');
  runCodemod(transformSpecArray, {
    roots: [join(BACKEND_ROOT, 'services')],
    label: 'codemod:spec-array',
    write,
  });
}
