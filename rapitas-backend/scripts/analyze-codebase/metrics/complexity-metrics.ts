/**
 * analyze-codebase/metrics/complexity-metrics
 *
 * Detects oversized files (god objects), long functions, deep nesting, and
 * excessive imports in TypeScript source files.
 * Excludes test files and scripts from analysis to avoid false positives.
 */

import { THRESHOLDS } from '../constants';
import type { FileInfo, ComplexityWarning, AnalysisResult } from '../types';

/**
 * Scans TypeScript source files for structural complexity issues.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Complexity warnings, god object list, and file line statistics / 複雑度警告・統計
 */
export function collectComplexityMetrics(files: FileInfo[]): AnalysisResult['complexity'] {
  const warnings: ComplexityWarning[] = [];
  const godObjects: string[] = [];
  const longFunctions: { file: string; name: string; lines: number }[] = [];

  const tsFiles = files.filter(
    (f) =>
      (f.ext === '.ts' || f.ext === '.tsx') &&
      !f.relativePath.match(/\.(test|spec)\./) &&
      !f.relativePath.includes('scripts') &&
      !f.relativePath.includes('node_modules'),
  );

  for (const f of tsFiles) {
    // God object detection (services/components with too many methods/exports)
    if (f.lines > THRESHOLDS.criticalFileLines) {
      warnings.push({
        file: f.relativePath,
        type: 'critical_size',
        message: `Critical: ${f.lines} lines - immediate refactoring needed`,
        lines: f.lines,
        severity: 'critical',
      });
      godObjects.push(f.relativePath);
    } else if (f.lines > THRESHOLDS.oversizedFileLines) {
      warnings.push({
        file: f.relativePath,
        type: 'oversized',
        message: `Oversized: ${f.lines} lines - consider splitting`,
        lines: f.lines,
        severity: 'warning',
      });
    } else if (f.lines > THRESHOLDS.godObjectLines) {
      // Check if it has many exports (god object indicator)
      const exportCount = (
        f.content.match(/\bexport\s+(function|class|const|interface|type|async\s+function)/g) || []
      ).length;
      if (exportCount > 10) {
        warnings.push({
          file: f.relativePath,
          type: 'god_object',
          message: `Potential god object: ${f.lines} lines with ${exportCount} exports`,
          lines: f.lines,
          severity: 'warning',
        });
        godObjects.push(f.relativePath);
      }
    }

    // Long function detection (standalone functions, not React components or class methods)
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
    let funcMatch;
    const lines = f.content.split('\n');
    while ((funcMatch = funcRegex.exec(f.content)) !== null) {
      const funcName = funcMatch[1];
      // Skip React component functions (PascalCase in .tsx files)
      if (f.ext === '.tsx' && /^[A-Z]/.test(funcName)) continue;
      const startLine = f.content.substring(0, funcMatch.index).split('\n').length;
      // Find matching brace end
      let depth = 0;
      let funcEnd = startLine;
      let foundStart = false;
      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
          if (ch === '{') {
            depth++;
            foundStart = true;
          }
          if (ch === '}') depth--;
          if (foundStart && depth === 0) {
            funcEnd = i + 1;
            break;
          }
        }
        if (foundStart && depth === 0) break;
      }
      const funcLines = funcEnd - startLine + 1;
      if (funcLines > THRESHOLDS.maxFunctionLines) {
        longFunctions.push({
          file: f.relativePath,
          name: funcName,
          lines: funcLines,
        });
      }
    }

    // Deep nesting detection
    let maxDepth = 0;
    let currentDepth = 0;
    for (const line of lines) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      currentDepth += opens - closes;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
    }
    if (maxDepth > THRESHOLDS.maxNestingDepth) {
      warnings.push({
        file: f.relativePath,
        type: 'deep_nesting',
        message: `Max nesting depth: ${maxDepth} levels`,
        lines: f.lines,
        severity: maxDepth > 8 ? 'warning' : 'info',
      });
    }

    // Too many imports
    const importCount = (f.content.match(/^import\s+/gm) || []).length;
    if (importCount > THRESHOLDS.maxImportsPerFile) {
      warnings.push({
        file: f.relativePath,
        type: 'too_many_imports',
        message: `${importCount} imports - may indicate low cohesion`,
        lines: f.lines,
        severity: importCount > 30 ? 'warning' : 'info',
      });
    }
  }

  // File line statistics
  const tsFilesLines = tsFiles.map((f) => f.lines).sort((a, b) => a - b);
  const avgFileLines =
    tsFilesLines.length > 0
      ? Math.round(tsFilesLines.reduce((a, b) => a + b, 0) / tsFilesLines.length)
      : 0;
  const medianFileLines =
    tsFilesLines.length > 0 ? tsFilesLines[Math.floor(tsFilesLines.length / 2)] : 0;

  return {
    warnings: warnings.sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, info: 2 };
      return sevOrder[a.severity] - sevOrder[b.severity] || b.lines - a.lines;
    }),
    godObjects,
    avgFileLines,
    medianFileLines,
    filesOver500Lines: tsFiles.filter((f) => f.lines > 500).length,
    filesOver1000Lines: tsFiles.filter((f) => f.lines > 1000).length,
    longFunctions: longFunctions.sort((a, b) => b.lines - a.lines).slice(0, 20),
  };
}
