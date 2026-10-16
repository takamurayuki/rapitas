/**
 * codemod: insensitive-spread
 *
 * Replaces the Pattern B1 idiom (intermediate spread variable):
 *   const insensitive = getInsensitiveMode();
 *   // ... later ...
 *   { contains: q, ...insensitive }
 * with the inlined form:
 *   { contains: q, ...getInsensitiveMode() }
 *
 * Safety boundary: only transforms when ALL of the following hold:
 *   1. Declaration has no `: any` type annotation
 *   2. Neither the declaration line nor any spread site has an adjacent eslint-disable comment
 *   3. The variable is spread exactly ONCE in the file (`...<var>`)
 *   4. `getInsensitiveMode` is already imported (no new import needed)
 *
 * Cases that fail any condition are reported in manualReview and left unchanged.
 * Pattern B2 (`if (getDbProvider() === 'sqlite')` function-body branching) is
 * handled by insensitive-mode.ts — not in scope here.
 *
 * Scope: routes/ and services/ only.
 * Safety: defaults to dry-run. Pass `--write` to apply changes on disk.
 *
 * Usage:
 *   bun run scripts/codemods/insensitive-spread.ts             # dry-run
 *   bun run scripts/codemods/insensitive-spread.ts -- --write  # apply
 */

import { join } from 'path';
import { runCodemod, type TransformInput, type TransformResult } from './lib/codemod-runner';

const BACKEND_ROOT = join(import.meta.dir, '..', '..');

/** A candidate Pattern B1 declaration found in a file. */
interface Candidate {
  /** Variable name (e.g. `insensitive`). */
  varName: string;
  /** Exact text of the declaration line (used for removal by regex). */
  declLine: string;
  /** 1-based line number for manualReview messages. */
  lineNumber: number;
  /** True when the declaration has a `: any` type annotation. */
  hasTypeAnnotation: boolean;
  /** True when eslint-disable appears on/before the declaration line OR on/before any spread site. */
  hasEslintDisable: boolean;
  /** Number of `...<varName>` spread references in the file. */
  spreadCount: number;
}

/**
 * Returns true if an eslint-disable comment appears on the given line or the line immediately before it.
 *
 * @param lines - All lines of the file / ファイルの全行
 * @param lineIndex - Zero-based index of the target line / 対象行の0始まりインデックス
 * @returns True if eslint-disable is present / eslint-disableが存在する場合true
 */
function hasEslintDisableNear(lines: string[], lineIndex: number): boolean {
  const prev = lineIndex > 0 ? lines[lineIndex - 1] : '';
  return /eslint-disable/.test(prev) || /eslint-disable/.test(lines[lineIndex]);
}

/**
 * Transforms a single file: inlines safe Pattern B1 intermediate spread variables.
 * Unsafe candidates (multi-reference / `: any` annotation / eslint-disable / un-imported)
 * are listed in manualReview without modifying the file.
 *
 * @param input - File path and content / ファイルパスと内容
 * @returns Transform result with changed flag and manualReview entries / 変換結果
 */
export function transformInsensitiveSpread(input: TransformInput): TransformResult {
  const { filePath, content } = input;
  const manualReview: string[] = [];

  // NOTE: Skip the definition file — it defines getInsensitiveMode() and must not self-modify.
  if (filePath.replace(/\\/g, '/').endsWith('config/db-provider.ts')) {
    return { newContent: content, changed: false, manualReview };
  }

  // Fast exit: no getInsensitiveMode() call present — nothing to do.
  if (!content.includes('getInsensitiveMode()')) {
    return { newContent: content, changed: false, manualReview };
  }

  const lines = content.split('\n');

  // Scan all Pattern B1 declaration lines.
  const candidates: Candidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Matches: const <var> = getInsensitiveMode(); [optional comment]
    // Also matches: const <var>: any = getInsensitiveMode(); (group 2 captures `: any`)
    const match = lines[i].match(
      /^[ \t]*const (\w+)(\s*:\s*any)?\s*=\s*getInsensitiveMode\(\);[ \t]*(?:\/\/[^\n]*)?$/,
    );
    if (!match) continue;

    const varName = match[1];
    const hasTypeAnnotation = !!match[2];

    // Check eslint-disable on/before declaration line.
    let hasEslintDisable = hasEslintDisableNear(lines, i);

    // Also check eslint-disable on/before each spread site —
    // inlining would break eslint-disable comments targeting the spread expressions.
    const spreadRe = new RegExp(`\\.\\.\\.${varName}\\b`);
    let spreadCount = 0;
    for (let j = 0; j < lines.length; j++) {
      if (spreadRe.test(lines[j])) {
        spreadCount++;
        if (hasEslintDisableNear(lines, j)) {
          hasEslintDisable = true;
        }
      }
    }

    candidates.push({
      varName,
      declLine: lines[i],
      lineNumber: i + 1,
      hasTypeAnnotation,
      hasEslintDisable,
      spreadCount,
    });
  }

  if (candidates.length === 0) {
    return { newContent: content, changed: false, manualReview };
  }

  // Whether `getInsensitiveMode` is already imported (required; we never add new imports).
  const isImported = /import\s*\{[^}]*\bgetInsensitiveMode\b[^}]*\}/.test(content);

  let newContent = content;
  let changed = false;

  for (const candidate of candidates) {
    const { varName, declLine, lineNumber, hasTypeAnnotation, hasEslintDisable, spreadCount } =
      candidate;

    // Collect reasons why this candidate cannot be auto-transformed.
    const reasons: string[] = [];
    if (hasTypeAnnotation) reasons.push('`: any` type annotation');
    if (hasEslintDisable) reasons.push('eslint-disable comment');
    if (spreadCount !== 1) reasons.push(`${spreadCount} spread reference(s) (expected 1)`);
    if (!isImported) reasons.push('getInsensitiveMode not imported');

    if (reasons.length > 0) {
      manualReview.push(
        `${filePath}:${lineNumber} — Pattern B1: ${varName} = getInsensitiveMode() (${reasons.join(', ')})`,
      );
      continue;
    }

    // Safe: replace `...<varName>` with `...getInsensitiveMode()`.
    newContent = newContent.replace(
      new RegExp(`\\.\\.\\.${varName}\\b`),
      '...getInsensitiveMode()',
    );

    // Remove the declaration line (including its trailing newline).
    const escapedDecl = declLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newContent = newContent.replace(new RegExp(`^${escapedDecl}\n?`, 'm'), '');

    changed = true;
  }

  return { newContent, changed, manualReview };
}

if (import.meta.main) {
  const write = process.argv.includes('--write');
  runCodemod(transformInsensitiveSpread, {
    roots: [join(BACKEND_ROOT, 'routes'), join(BACKEND_ROOT, 'services')],
    label: 'codemod:insensitive-spread',
    write,
  });
}
