/**
 * codemod: response-helper
 *
 * Replaces inline `{ success: true/false, ... }` literals in routes/ with
 * the canonical helpers from utils/common/response:
 *
 *   { success: true }              → createResponse(undefined)
 *   { success: true, data: x }     → createResponse(x)
 *   { success: true, data: x, message: m } → createResponse(x, m)
 *   { success: false, error: 'msg' } → createErrorResponse('msg')
 *   { success: false, error: msg }   → createErrorResponse(msg)
 *
 * Objects that carry EXTRA fields beyond the above allowlist are skipped and
 * added to the manual-review list (they may not conform to ApiResponse<T>).
 *
 * Scope: routes/ only.
 * Safety: defaults to dry-run. Pass `--write` to apply changes on disk.
 *
 * Usage:
 *   bun run scripts/codemods/response-helper.ts             # dry-run
 *   bun run scripts/codemods/response-helper.ts -- --write  # apply
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
const RESPONSE_MODULE = join(BACKEND_ROOT, 'utils', 'common', 'response');

// Allowed keys in the success envelope (beyond `success` itself).
const SUCCESS_ALLOWED_KEYS = new Set(['data', 'message']);
// Allowed keys in the error envelope.
const ERROR_ALLOWED_KEYS = new Set(['error', 'code']);

/**
 * Parses a simple flat object literal `{ k1: v1, k2: v2, ... }` into a map
 * of key → raw-value-string. Returns null if the content is too complex
 * (nested objects, spread operators, computed keys) to safely parse.
 *
 * @param objectLiteral - Source string including surrounding braces / 中括弧含むオブジェクトリテラル
 * @returns Map of key to value string, or null if unparseable / キー→値のマップ、パース不能時はnull
 */
function parseSimpleObject(objectLiteral: string): Map<string, string> | null {
  const inner = objectLiteral.slice(1, -1).trim();
  if (!inner) return new Map();

  // Reject spreads and computed keys immediately.
  if (inner.includes('...') || inner.includes('[')) return null;

  const result = new Map<string, string>();
  // Split by top-level commas only (depth tracking for nested parens/brackets).
  let depth = 0;
  let start = 0;
  const pairs: string[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      pairs.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  pairs.push(inner.slice(start).trim());

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) return null; // shorthand property — too ambiguous
    const key = pair.slice(0, colonIdx).trim();
    const val = pair.slice(colonIdx + 1).trim();
    // Reject keys that look like identifiers with dots/brackets.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return null;
    result.set(key, val);
  }
  return result;
}

/**
 * Transforms a single file: replaces inline response literals with helper calls.
 *
 * @param input - File path and content / ファイルパスと内容
 * @returns Transform result / 変換結果
 */
export function transformResponseHelper(input: TransformInput): TransformResult {
  const { filePath, content } = input;
  const manualReview: string[] = [];
  let newContent = content;
  let changed = false;

  // Fast-exit: no inline patterns to process.
  if (!newContent.includes('success: true') && !newContent.includes('success: false')) {
    return { newContent, changed: false, manualReview };
  }

  // Already fully migrated — idempotent guard.
  const lines = newContent.split('\n');

  // Process line by line for single-line patterns (most common in routes/).
  const resultLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (!line.includes('success:')) {
      resultLines.push(line);
      continue;
    }

    // Match a simple single-line object literal on this line.
    // We look for `{` ... `}` with no nesting (depth never > 1 within the match).
    const objMatch = line.match(/(\{[^{}]*\})/);
    if (!objMatch) {
      resultLines.push(line);
      continue;
    }

    const objStr = objMatch[1];
    const parsed = parseSimpleObject(objStr);

    if (!parsed) {
      // Could not safely parse — hand off for manual review.
      if (parsed === null) {
        manualReview.push(`${filePath}:${lineNum} — complex object, manual review needed`);
      }
      resultLines.push(line);
      continue;
    }

    const successVal = parsed.get('success');
    if (successVal === 'true') {
      // Check for extra keys.
      const extraKeys = [...parsed.keys()].filter(
        (k) => k !== 'success' && !SUCCESS_ALLOWED_KEYS.has(k),
      );
      if (extraKeys.length > 0) {
        manualReview.push(
          `${filePath}:${lineNum} — extra fields {${extraKeys.join(', ')}}, needs manual migration`,
        );
        resultLines.push(line);
        continue;
      }

      const data = parsed.get('data');
      const message = parsed.get('message');
      let replacement: string;
      if (data !== undefined && message !== undefined) {
        replacement = `createResponse(${data}, ${message})`;
      } else if (data !== undefined) {
        replacement = `createResponse(${data})`;
      } else if (message !== undefined) {
        replacement = `createResponse(undefined, ${message})`;
      } else {
        replacement = `createResponse(undefined)`;
      }

      const newLine = line.replace(objStr, replacement);
      if (newLine !== line) {
        resultLines.push(newLine);
        changed = true;
        continue;
      }
    } else if (successVal === 'false') {
      // Check for extra keys.
      const extraKeys = [...parsed.keys()].filter(
        (k) => k !== 'success' && !ERROR_ALLOWED_KEYS.has(k),
      );
      if (extraKeys.length > 0) {
        manualReview.push(
          `${filePath}:${lineNum} — extra fields {${extraKeys.join(', ')}}, needs manual migration`,
        );
        resultLines.push(line);
        continue;
      }

      const error = parsed.get('error');
      const code = parsed.get('code');
      if (error === undefined) {
        // { success: false } without error field — unusual, emit manual review.
        manualReview.push(`${filePath}:${lineNum} — { success: false } without error field`);
        resultLines.push(line);
        continue;
      }

      let replacement: string;
      if (code !== undefined) {
        replacement = `createErrorResponse(${error}, ${code})`;
      } else {
        replacement = `createErrorResponse(${error})`;
      }

      const newLine = line.replace(objStr, replacement);
      if (newLine !== line) {
        resultLines.push(newLine);
        changed = true;
        continue;
      }
    }

    resultLines.push(line);
  }

  if (changed) {
    newContent = resultLines.join('\n');
    const modulePath = relativeImportPath(filePath, RESPONSE_MODULE);
    newContent = ensureImport(newContent, 'createResponse', modulePath);
    newContent = ensureImport(newContent, 'createErrorResponse', modulePath);
  }

  return { newContent, changed, manualReview };
}

if (import.meta.main) {
  const write = process.argv.includes('--write');
  runCodemod(transformResponseHelper, {
    roots: [join(BACKEND_ROOT, 'routes')],
    label: 'codemod:response',
    write,
  });
}
