/**
 * analyze-codebase/metrics/maintainability-metrics
 *
 * Computes maintainability sub-scores: file size distribution, function length,
 * nesting depth, code duplication (normalized line-hash), and cyclomatic
 * complexity proxy (branch count per file).
 */

import type { FileInfo, MaintainabilityMetrics, AnalysisResult } from '../types';

/**
 * Computes maintainability sub-scores from source files and complexity data.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @param complexity - Previously computed complexity metrics / 複雑度メトリクス
 * @returns Maintainability breakdown including duplication and cyclomatic complexity / 保守性指標
 */
export function collectMaintainabilityMetrics(
  files: FileInfo[],
  complexity: AnalysisResult['complexity'],
): MaintainabilityMetrics {
  const tsFiles = files.filter(
    (f) =>
      (f.ext === '.ts' || f.ext === '.tsx') &&
      !f.relativePath.match(/\.(test|spec)\./) &&
      !f.relativePath.includes('__tests__') &&
      !f.relativePath.includes('scripts/'),
  );

  // 1. File size distribution score (% under 500 lines)
  const filesUnder500 = tsFiles.filter((f) => f.lines <= 500).length;
  const fileSizeScore =
    tsFiles.length > 0 ? Math.round((filesUnder500 / tsFiles.length) * 100) : 100;

  // 2. Function length score (% of detected functions under 100 lines)
  const totalLongFunctions = complexity.longFunctions.length;
  // NOTE: Rough heuristic — ~3 functions per file on average. Exact count requires full AST.
  const estimatedTotalFunctions = tsFiles.length * 3;
  const functionLengthScore =
    estimatedTotalFunctions > 0
      ? Math.round(((estimatedTotalFunctions - totalLongFunctions) / estimatedTotalFunctions) * 100)
      : 100;

  // 3. Nesting depth score
  const nestingWarnings = complexity.warnings.filter((w) => w.type === 'deep_nesting');
  const avgMaxNesting =
    nestingWarnings.length > 0
      ? nestingWarnings.reduce((sum, w) => {
          const depthMatch = w.message.match(/(\d+)\s*levels/);
          return sum + (depthMatch ? parseInt(depthMatch[1]) : 5);
        }, 0) / nestingWarnings.length
      : 3;
  // Score: depth 3 = 100, depth 5 = 80, depth 8 = 50, depth 12+ = 0
  const nestingScore = Math.max(0, Math.min(100, Math.round(140 - avgMaxNesting * 12)));

  // 4. Code duplication detection (normalized line hashing)
  const BLOCK_SIZE = 6; // consecutive lines to form a block
  const blockMap = new Map<string, { path: string; startLine: number }[]>();
  let totalSourceLines = 0;

  for (const f of tsFiles) {
    const lines = f.content.split('\n');
    totalSourceLines += lines.length;

    for (let i = 0; i <= lines.length - BLOCK_SIZE; i++) {
      const block = lines
        .slice(i, i + BLOCK_SIZE)
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('import '),
        );

      // Skip blocks with too few meaningful lines
      if (block.length < 4) continue;

      const normalized = block
        .map(
          (l) =>
            l
              .replace(/\s+/g, ' ')
              .replace(/["'`][^"'`]*["'`]/g, '""') // normalize strings
              .replace(/\d+/g, '0'), // normalize numbers
        )
        .join('\n');

      // Skip trivial blocks (just braces, returns, etc.)
      if (normalized.length < 80) continue;

      // Simple hash
      let hash = 0;
      for (let c = 0; c < normalized.length; c++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(c)) | 0;
      }
      const hashStr = hash.toString(36);

      if (!blockMap.has(hashStr)) blockMap.set(hashStr, []);
      blockMap.get(hashStr)!.push({ path: f.relativePath, startLine: i + 1 });
    }
  }

  // Filter to only blocks that appear in 2+ different files
  const duplicatedBlocks: MaintainabilityMetrics['duplicatedBlocks'] = [];
  let totalDuplicatedLines = 0;

  for (const [hash, locations] of blockMap.entries()) {
    const uniqueFiles = new Set(locations.map((l) => l.path));
    if (uniqueFiles.size >= 2) {
      // Deduplicate locations per file (keep first occurrence)
      const deduped = new Map<string, { path: string; startLine: number }>();
      for (const loc of locations) {
        if (!deduped.has(loc.path)) deduped.set(loc.path, loc);
      }
      const dedupedLocs = [...deduped.values()];

      duplicatedBlocks.push({
        hash,
        files: dedupedLocs,
        lines: BLOCK_SIZE,
      });
      totalDuplicatedLines += BLOCK_SIZE * (dedupedLocs.length - 1);
    }
  }

  duplicatedBlocks.sort((a, b) => b.files.length - a.files.length);
  const topDuplicates = duplicatedBlocks.slice(0, 30);

  const duplicationRatio =
    totalSourceLines > 0
      ? Math.round((totalDuplicatedLines / totalSourceLines) * 10000) / 10000
      : 0;

  // duplicationScore: 0% = 100, 5% = 75, 10% = 50, 20%+ = 0
  const duplicationScore = Math.max(0, Math.min(100, Math.round(100 - duplicationRatio * 500)));

  // 5. Cyclomatic complexity proxy (count branches per file)
  let totalBranches = 0;
  let fileCount = 0;
  for (const f of tsFiles) {
    const branches = (
      f.content.match(/\b(if|else if|switch|case|for|while|do|catch|\?\?|&&|\|\||ternary)\b/g) || []
    ).length;
    // Also count ternary operators
    const ternaries = (f.content.match(/\?[^?:]*:/g) || []).length;
    totalBranches += branches + ternaries;
    fileCount++;
  }
  const avgCyclomaticComplexity =
    fileCount > 0 ? Math.round((totalBranches / fileCount) * 10) / 10 : 0;

  return {
    fileSizeScore,
    functionLengthScore,
    nestingScore,
    duplicationScore,
    duplicatedBlocks: topDuplicates,
    totalDuplicatedLines,
    duplicationRatio,
    avgCyclomaticComplexity,
  };
}
