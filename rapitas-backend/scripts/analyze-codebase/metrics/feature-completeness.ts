/**
 * analyze-codebase/metrics/feature-completeness
 *
 * Scores each feature area by counting routes, services, components, hooks,
 * Prisma models, and tests. Uses proportional weighting so partial coverage
 * yields partial points rather than binary all-or-nothing scoring.
 */

import { basename, extname } from 'path';
import { FEATURE_AREAS_CONFIG } from './test-coverage';
import type { FileInfo, FeatureArea, AnalysisResult } from '../types';

export { FEATURE_AREAS_CONFIG };

/**
 * Computes feature completeness scores for all configured feature areas.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @param arch - Architecture metrics (used for Prisma model counts) / アーキテクチャ集計
 * @returns Scored feature area list / フィーチャーエリアスコア一覧
 */
export function collectFeatureCompleteness(
  files: FileInfo[],
  arch: AnalysisResult['architecture'],
): FeatureArea[] {
  const testFiles = files.filter((f) => f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/));
  const sourceFiles = files.filter(
    (f) => (f.ext === '.ts' || f.ext === '.tsx') && !f.relativePath.match(/\.(test|spec)\./),
  );

  return FEATURE_AREAS_CONFIG.map((area) => {
    const matchesKeyword = (path: string) =>
      area.keywords.some((kw) => path.toLowerCase().includes(kw));

    const routes = files.filter(
      (f) =>
        f.relativePath.startsWith('rapitas-backend') &&
        f.relativePath.includes('routes') &&
        matchesKeyword(f.relativePath),
    ).length;

    const services = files.filter(
      (f) =>
        f.relativePath.startsWith('rapitas-backend') &&
        f.relativePath.includes('services') &&
        matchesKeyword(f.relativePath),
    ).length;

    const components = files.filter(
      (f) =>
        f.relativePath.startsWith('rapitas-frontend') &&
        f.ext === '.tsx' &&
        matchesKeyword(f.relativePath),
    ).length;

    const hooks = files.filter(
      (f) =>
        f.relativePath.startsWith('rapitas-frontend') &&
        (f.relativePath.includes('hooks') ||
          /\/use[A-Z]/.test(f.relativePath) ||
          f.relativePath.includes('Store')) &&
        matchesKeyword(f.relativePath),
    ).length;

    const models = arch.prisma.models.filter((m) =>
      area.keywords.some((kw) => m.name.toLowerCase().includes(kw)),
    ).length;

    const tests = files.filter(
      (f) => f.relativePath.match(/\.(test|spec)\./) && matchesKeyword(f.relativePath),
    ).length;

    // Find untested source files for this feature
    const featureSourceFiles = sourceFiles.filter((f) => matchesKeyword(f.relativePath));
    const featureTestBases = testFiles
      .filter((f) => matchesKeyword(f.relativePath))
      .map((f) =>
        basename(f.relativePath)
          .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '')
          .toLowerCase(),
      );
    const untestedSourceFiles = featureSourceFiles
      .filter((f) => {
        const srcBase = basename(f.relativePath, extname(f.relativePath)).toLowerCase();
        return !featureTestBases.some(
          (tb) => tb === srcBase || srcBase.includes(tb) || tb.includes(srcBase),
        );
      })
      .map((f) => f.relativePath);

    // Proportional scoring (weighted, not binary):
    // Routes: 0-20 (1 route = 7pts, capped at 20)
    // Services: 0-15 (1 service = 5pts, capped at 15)
    // Components: 0-20 (1 component = 4pts, capped at 20)
    // Hooks: 0-15 (1 hook = 5pts, capped at 15)
    // Models: 0-15 (1 model = 5pts, capped at 15)
    // Tests: 0-15 (1 test = 5pts, capped at 15)
    let score = 0;
    score += Math.min(20, routes * 7);
    score += Math.min(15, services * 5);
    score += Math.min(20, components * 4);
    score += Math.min(15, hooks * 5);
    score += Math.min(15, models * 5);
    score += Math.min(15, tests * 5);

    return {
      name: area.name,
      routes,
      services,
      components,
      hooks,
      models,
      tests,
      untestedSourceFiles,
      score,
    };
  });
}
