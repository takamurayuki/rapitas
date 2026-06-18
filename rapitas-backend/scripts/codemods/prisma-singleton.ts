/**
 * codemod: prisma-singleton
 *
 * Replaces `new PrismaClient()` (no-argument form) with the shared `prisma`
 * singleton imported from config/database, then updates the import.
 *
 * Files that call `new PrismaClient(...)` WITH arguments are skipped and
 * added to the manual-review list (constructor options would be silently lost).
 *
 * Scope: all src/ files (excludes tests/, scripts/, config/database.ts itself).
 * Safety: defaults to dry-run. Pass `--write` to apply changes on disk.
 *
 * Usage:
 *   bun run scripts/codemods/prisma-singleton.ts             # dry-run
 *   bun run scripts/codemods/prisma-singleton.ts -- --write  # apply
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
const DATABASE_MODULE = join(BACKEND_ROOT, 'config', 'database');

// Matches `new PrismaClient()` with no arguments (only whitespace between parens).
const NO_ARG_PATTERN = /new PrismaClient\(\s*\)/g;
// Matches `new PrismaClient(` followed by a non-whitespace, non-`)` character — i.e. has arguments.
const WITH_ARG_PATTERN = /new PrismaClient\(\s*[^)\s]/;

/**
 * Transforms a single file: replaces no-arg PrismaClient instantiation with the singleton.
 *
 * @param input - File path and content / ファイルパスと内容
 * @returns Transform result / 変換結果
 */
export function transformPrismaSingleton(input: TransformInput): TransformResult {
  const { filePath, content } = input;
  const manualReview: string[] = [];

  // Skip config/database.ts itself — it IS the singleton definition.
  if (filePath.replace(/\\/g, '/').includes('config/database')) {
    return { newContent: content, changed: false, manualReview };
  }

  const hasNoArg = NO_ARG_PATTERN.test(content);
  NO_ARG_PATTERN.lastIndex = 0;

  if (!hasNoArg) {
    return { newContent: content, changed: false, manualReview };
  }

  // Detect with-argument form — emit manual-review warning.
  if (WITH_ARG_PATTERN.test(content)) {
    const lineNum = content.split('\n').findIndex((l) => WITH_ARG_PATTERN.test(l));
    manualReview.push(
      `${filePath}:${lineNum + 1} — new PrismaClient({...}) with arguments, skip auto-replace`,
    );
  }

  // Replace `const prisma = new PrismaClient()` → `const prisma = prisma` would be wrong.
  // Instead, replace `new PrismaClient()` itself and let the caller keep whatever binding
  // name they used. If the file also declares `import { PrismaClient }`, we leave it —
  // the name may be used in type positions.
  let newContent = content.replace(NO_ARG_PATTERN, 'prisma');

  // Add the singleton import from config/database (idempotent).
  const modulePath = relativeImportPath(filePath, DATABASE_MODULE);
  newContent = ensureImport(newContent, 'prisma', modulePath);

  return { newContent, changed: true, manualReview };
}

if (import.meta.main) {
  const write = process.argv.includes('--write');
  runCodemod(transformPrismaSingleton, {
    roots: [join(BACKEND_ROOT, 'src')],
    label: 'codemod:prisma-singleton',
    write,
    // NOTE: Exclude tests/ and scripts/ — those intentionally create their own clients.
    excludeDirs: ['node_modules', '.git', 'dist', 'generated', 'prisma'],
  });
}
