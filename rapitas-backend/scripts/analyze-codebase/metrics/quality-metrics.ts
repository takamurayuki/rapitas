/**
 * analyze-codebase/metrics/quality-metrics
 *
 * Scans TypeScript/TSX source and test files for code hygiene indicators:
 * any usage, TODO/FIXME/HACK comments, console.log calls, try/catch patterns,
 * and test assertion counts.
 */

import type { FileInfo, AnalysisResult } from '../types';

/**
 * Scans all TypeScript files for quality indicators.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Quality metric counters / コード品質の各種カウント
 */
export function collectQualityMetrics(files: FileInfo[]): AnalysisResult['quality'] {
  const tsFiles = files.filter((f) => f.ext === '.ts' || f.ext === '.tsx');
  const testFiles = files.filter(
    (f) =>
      f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) ||
      f.relativePath.includes('__tests__'),
  );
  const sourceFiles = tsFiles.filter(
    (f) =>
      !f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) &&
      !f.relativePath.includes('__tests__'),
  );

  let anyUsage = 0;
  let todoCount = 0;
  let fixmeCount = 0;
  let hackCount = 0;
  let consoleLogCount = 0;
  let tryCatchCount = 0;
  let emptyTryCatchCount = 0;
  let assertionCount = 0;

  const isTestFile = (f: FileInfo) =>
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f.relativePath) || f.relativePath.includes('__tests__');

  for (const f of tsFiles) {
    const isTest = isTestFile(f);
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        if (!isTest && (/:\s*any\b/.test(line) || /as\s+any\b/.test(line) || /<any>/.test(line))) {
          anyUsage++;
        }
      }
      if (/\/\/\s*TODO[\s:]/i.test(line)) todoCount++;
      if (/\/\/\s*FIXME[\s:]/i.test(line)) fixmeCount++;
      if (/\/\/\s*HACK[\s:]/i.test(line)) hackCount++;
      if (
        !isTest &&
        /console\.log\s*\(/.test(line) &&
        !line.trim().startsWith('//') &&
        !line.trim().startsWith('*') &&
        !/["'`].*console\.log/.test(line)
      )
        consoleLogCount++;
      if (/\btry\s*\{/.test(line)) {
        tryCatchCount++;
      }
      // Detect empty catch blocks (single-line and multiline)
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
        emptyTryCatchCount++;
      } else if (/catch\s*(\([^)]*\))?\s*\{\s*$/.test(line)) {
        // Check if next non-empty line is just "}"
        const nextLine = lines.slice(i + 1).find((l) => l.trim().length > 0);
        if (nextLine && /^\s*\}\s*$/.test(nextLine)) {
          emptyTryCatchCount++;
        }
      }
      // Count test assertions
      if (/\b(expect|assert|toBe|toEqual|toMatch|toThrow|toHaveBeenCalled)\s*\(/.test(line)) {
        assertionCount++;
      }
    }
  }

  const testRatio =
    sourceFiles.length > 0 ? Math.round((testFiles.length / sourceFiles.length) * 100) / 100 : 0;

  return {
    testFiles: testFiles.length,
    sourceFiles: sourceFiles.length,
    testRatio,
    anyUsage,
    todoCount,
    fixmeCount,
    hackCount,
    consoleLogCount,
    tryCatchCount,
    emptyTryCatchCount,
    assertionCount,
  };
}
