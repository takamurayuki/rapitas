/**
 * analyze-codebase/metrics/architecture-health
 *
 * Measures inter-layer coupling, cohesion, modularity, and layer-boundary
 * violations (e.g. frontend importing backend, service importing routes).
 * Depends on the import graph computed by import-metrics.
 */

import { dirname } from 'path';
import type { FileInfo, ArchitectureHealth, AnalysisResult } from '../types';

/**
 * Evaluates coupling, cohesion, modularity, and layer violation counts.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @param importMetrics - Import graph data from collectImportMetrics / インポートグラフ
 * @returns Architecture health scores and violation list / アーキテクチャ健全性指標
 */
export function collectArchitectureHealth(
  files: FileInfo[],
  importMetrics: AnalysisResult['imports'],
): ArchitectureHealth {
  const tsFiles = files.filter(
    (f) => (f.ext === '.ts' || f.ext === '.tsx') && !f.relativePath.match(/\.(test|spec)\./),
  );

  // Layer violation detection
  const layerViolations: { file: string; message: string }[] = [];
  for (const f of tsFiles) {
    if (f.relativePath.startsWith('rapitas-frontend')) {
      // Frontend should not directly import backend modules
      if (/from\s+["'`].*rapitas-backend/.test(f.content)) {
        layerViolations.push({
          file: f.relativePath,
          message: 'Frontend file imports directly from backend',
        });
      }
    }
    if (f.relativePath.includes('routes') && f.relativePath.startsWith('rapitas-backend')) {
      // Route files should not import from other route files (go through services)
      // Exception: files that aggregate sub-routes via .use() pattern
      const isAggregator = /index\.ts$|register-routes\.ts$/.test(f.relativePath);
      const usesSubRoutes = /\.use\s*\(\s*\w+Routes?\s*\)/.test(f.content);
      // Exception: barrel/re-export files (contain only export statements, no route definitions)
      const isBarrelFile =
        /^\s*(?:\/\*\*[\s\S]*?\*\/\s*)?(?:export\s+\{[^}]+\}\s+from|export\s+\*\s+from|export\s+type\s+\{)/m.test(
          f.content,
        ) && !/\.(get|post|put|patch|delete)\s*\(/.test(f.content);
      const routeImports = f.content.match(/from\s+["'`]\..*routes/g);
      if (
        !isAggregator &&
        !usesSubRoutes &&
        !isBarrelFile &&
        routeImports &&
        routeImports.length > 0
      ) {
        layerViolations.push({
          file: f.relativePath,
          message: 'Route file imports from another route file (should go through services)',
        });
      }
    }
    if (f.relativePath.includes('services') && f.relativePath.startsWith('rapitas-backend')) {
      // Services should not import from routes
      if (/from\s+["'`].*routes/.test(f.content)) {
        layerViolations.push({
          file: f.relativePath,
          message: 'Service file imports from routes (inverted dependency)',
        });
      }
    }
  }

  // Coupling score (lower is better): based on average fan-out
  const fanOutValues = importMetrics.highFanOutFiles.map((f) => f.importCount);
  const avgFanOut =
    fanOutValues.length > 0 ? fanOutValues.reduce((a, b) => a + b, 0) / fanOutValues.length : 0;
  const couplingScore = Math.max(0, Math.min(100, Math.round(100 - avgFanOut * 3)));

  // Cohesion score: based on feature modularity (files in same directory import each other)
  const dirGroups = new Map<string, number>();
  for (const f of tsFiles) {
    const dir = dirname(f.relativePath);
    dirGroups.set(dir, (dirGroups.get(dir) || 0) + 1);
  }
  // Good cohesion = small directories with focused files
  const dirSizes = [...dirGroups.values()];
  const avgDirSize =
    dirSizes.length > 0 ? dirSizes.reduce((a, b) => a + b, 0) / dirSizes.length : 0;
  const cohesionScore = Math.max(
    0,
    Math.min(100, Math.round(100 - Math.max(0, avgDirSize - 5) * 5)),
  );

  // Modularity: ratio of well-structured directories
  const wellStructured = dirSizes.filter((s) => s >= 2 && s <= 15).length;
  const modularity = dirSizes.length > 0 ? Math.round((wellStructured / dirSizes.length) * 100) : 0;

  // High coupling files
  const highCouplingFiles = importMetrics.highFanOutFiles.slice(0, 10).map((f) => {
    const fanIn = importMetrics.highFanInFiles.find((fi) => fi.file === f.file);
    return {
      file: f.file,
      importCount: f.importCount,
      importedByCount: fanIn?.importedByCount || 0,
    };
  });

  // Isolated files (no imports AND not imported by others)
  const allImportedFiles = new Set(importMetrics.highFanInFiles.map((f) => f.file));
  const isolatedFiles = tsFiles
    .filter((f) => {
      const normalized = f.relativePath.replace(/\\/g, '/');
      const importCount = (f.content.match(/^import\s+/gm) || []).length;
      return importCount === 0 && !allImportedFiles.has(normalized);
    })
    .map((f) => f.relativePath)
    .slice(0, 10);

  return {
    couplingScore,
    cohesionScore,
    modularity,
    highCouplingFiles,
    isolatedFiles,
    layerViolations,
  };
}
