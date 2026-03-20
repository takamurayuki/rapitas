/**
 * analyze-codebase/metrics/code-metrics
 *
 * Aggregates raw line/size counts by file extension and directory, and
 * identifies the largest files in the project. Does not inspect file content.
 */

import type { FileInfo, ExtensionStats, AnalysisResult } from '../types';

/**
 * Aggregates file counts, line counts, and sizes by extension and directory.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Code metrics broken down by extension, directory, and top-20 largest files / 拡張子・ディレクトリ別集計とTop20
 */
export function collectCodeMetrics(files: FileInfo[]): AnalysisResult['codeMetrics'] {
  const extMap = new Map<string, { count: number; lines: number; size: number }>();
  for (const f of files) {
    const entry = extMap.get(f.ext) || { count: 0, lines: 0, size: 0 };
    entry.count++;
    entry.lines += f.lines;
    entry.size += f.size;
    extMap.set(f.ext, entry);
  }

  const byExtension: ExtensionStats[] = [...extMap.entries()]
    .map(([ext, data]) => ({
      extension: ext,
      fileCount: data.count,
      totalLines: data.lines,
      totalSize: data.size,
      avgLines: Math.round(data.lines / data.count),
    }))
    .sort((a, b) => b.totalLines - a.totalLines);

  const byDirectory: Record<string, { files: number; lines: number; size: number }> = {};
  for (const f of files) {
    const parts = f.relativePath.split(/[\\/]/);
    const topDir = parts[0] || 'root';
    if (!byDirectory[topDir]) byDirectory[topDir] = { files: 0, lines: 0, size: 0 };
    byDirectory[topDir].files++;
    byDirectory[topDir].lines += f.lines;
    byDirectory[topDir].size += f.size;
  }

  const largestFiles = [...files]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 20)
    .map((f) => ({ path: f.relativePath, lines: f.lines, size: f.size }));

  return {
    byExtension,
    byDirectory,
    largestFiles,
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lines, 0),
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
  };
}
