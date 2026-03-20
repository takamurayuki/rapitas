/**
 * analyze-codebase/metrics/import-metrics
 *
 * Builds an import dependency graph from TypeScript source files and uses
 * depth-limited DFS to detect circular dependencies. Also reports high fan-out
 * (many imports) and high fan-in (imported by many files) hotspots.
 */

import { join, dirname } from 'path';
import type { FileInfo, CircularDependency, AnalysisResult } from '../types';

/**
 * Builds an import graph and detects circular dependencies, fan-out, and fan-in.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Import graph statistics and circular dependency list / 依存グラフ統計
 */
export function collectImportMetrics(files: FileInfo[]): AnalysisResult['imports'] {
  const tsFiles = files.filter(
    (f) => (f.ext === '.ts' || f.ext === '.tsx') && !f.relativePath.includes('node_modules'),
  );

  // Build import graph
  const importGraph = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();

  for (const f of tsFiles) {
    const imports = new Set<string>();
    const importRegex = /import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?["'`]([^"'`]+)["'`]/g;
    let match;
    while ((match = importRegex.exec(f.content)) !== null) {
      const importPath = match[1];
      // Only track local imports
      if (importPath.startsWith('.') || importPath.startsWith('@/')) {
        // Resolve relative path
        let resolvedBase: string;
        if (importPath.startsWith('@/')) {
          // NOTE: @/ is assumed to map to src/ in frontend and the root in backend.
          const srcDir = f.relativePath.startsWith('rapitas-frontend')
            ? 'rapitas-frontend/src'
            : f.relativePath.startsWith('rapitas-backend')
              ? 'rapitas-backend'
              : '';
          resolvedBase = srcDir ? join(srcDir, importPath.slice(2)) : importPath;
        } else {
          resolvedBase = join(dirname(f.relativePath), importPath).replace(/\\/g, '/');
        }
        // Normalize: remove extension, add .ts if needed
        const normalized = resolvedBase.replace(/\.(ts|tsx|js|jsx)$/, '').replace(/\\/g, '/');
        imports.add(normalized);

        if (!importedBy.has(normalized)) importedBy.set(normalized, new Set());
        importedBy.get(normalized)!.add(f.relativePath.replace(/\\/g, '/'));
      }
    }
    importGraph.set(f.relativePath.replace(/\\/g, '/'), imports);
  }

  // Detect circular dependencies (DFS with cycle detection, limited depth)
  const circularDeps: CircularDependency[] = [];
  const visited = new Set<string>();

  function findCycles(node: string, path: string[], depthLimit: number): void {
    if (depthLimit <= 0) return;
    if (path.includes(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      // Deduplicate: normalize cycle to start from lexically smallest
      const minIdx = cycle.indexOf([...cycle].sort()[0]);
      const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
      const key = normalized.join(' -> ');
      if (!visited.has(key)) {
        visited.add(key);
        circularDeps.push({ cycle: normalized });
      }
      return;
    }

    const imports = importGraph.get(node);
    if (!imports) return;

    for (const imp of imports) {
      findCycles(imp, [...path, node], depthLimit - 1);
    }
  }

  for (const node of importGraph.keys()) {
    findCycles(node, [], 8);
    if (circularDeps.length > 50) break; // Limit output
  }

  // High fan-out (files importing many others)
  const highFanOutFiles = [...importGraph.entries()]
    .map(([file, imports]) => ({ file, importCount: imports.size }))
    .filter((f) => f.importCount > 10)
    .sort((a, b) => b.importCount - a.importCount)
    .slice(0, 15);

  // High fan-in (files imported by many others)
  const highFanInFiles = [...importedBy.entries()]
    .map(([file, importers]) => ({ file, importedByCount: importers.size }))
    .filter((f) => f.importedByCount > 5)
    .sort((a, b) => b.importedByCount - a.importedByCount)
    .slice(0, 15);

  return {
    circularDependencies: circularDeps.slice(0, 30),
    highFanOutFiles,
    highFanInFiles,
  };
}
