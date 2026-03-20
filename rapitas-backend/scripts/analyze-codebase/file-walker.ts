/**
 * analyze-codebase/file-walker
 *
 * Recursively walks the project directory tree and collects metadata for
 * every code file. Excludes generated/vendor directories and oversized files.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { PROJECT_ROOT, EXCLUDED_DIRS, CODE_EXTENSIONS } from './constants';
import type { FileInfo } from './types';

/**
 * Recursively collects all code files starting from a directory.
 *
 * @param dir - Root directory to start the walk from / 走査開始ディレクトリ
 * @param allFiles - Accumulator array, populated in-place / 結果を蓄積する配列
 * @returns The same array populated with discovered FileInfo entries / FileInfo配列
 */
export function walkDir(dir: string, allFiles: FileInfo[] = []): FileInfo[] {
  if (!existsSync(dir)) return allFiles;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return allFiles;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, allFiles);
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      // NOTE: Skip very large files — they are almost certainly generated or bundled artifacts.
      if (stat.size > 500_000) continue;

      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n').length;
      allFiles.push({
        path: fullPath,
        relativePath: relative(PROJECT_ROOT, fullPath),
        ext,
        lines,
        size: stat.size,
        content,
      });
    }
  }

  return allFiles;
}
