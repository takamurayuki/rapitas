/**
 * analyze-codebase/metrics/test-coverage
 *
 * Maps source files to test files by feature area and computes per-feature
 * and overall test coverage ratios. Also identifies critical untested files
 * (source files over 200 lines with no matching test file).
 */

import { basename, extname } from 'path';
import type { FileInfo, AnalysisResult } from '../types';

/** Feature area configuration used for both test coverage and feature completeness. */
export const FEATURE_AREAS_CONFIG = [
  { name: 'Task Management', keywords: ['task', 'tasks'] },
  { name: 'Pomodoro/Time Management', keywords: ['pomodoro', 'time-entr', 'timer', 'time-management'] },
  {
    name: 'AI Agent',
    keywords: ['agent', 'ai-agent', 'ai-chat', 'claude'],
  },
  { name: 'Workflow', keywords: ['workflow'] },
  { name: 'GitHub Integration', keywords: ['github'] },
  { name: 'Authentication', keywords: ['auth', 'login', 'register', 'session', 'authcontext'] },
  { name: 'Notifications', keywords: ['notification', 'notify', 'sse', 'realtime'] },
  { name: 'Search', keywords: ['search', 'filter', 'icon-search'] },
  {
    name: 'Calendar/Schedule',
    keywords: ['calendar', 'schedule', 'daily-schedule'],
  },
  {
    name: 'Learning/Habits',
    keywords: ['habit', 'study', 'learning', 'flashcard', 'exam', 'streak'],
  },
  {
    name: 'Analytics/Reports',
    keywords: ['report', 'statistic', 'analytics', 'burnup', 'progress'],
  },
];

/**
 * Computes per-feature and overall test coverage by matching source and test files.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @param featureAreas - Feature keyword definitions / フィーチャー定義
 * @returns Coverage details per feature, overall ratio, and critical untested files / カバレッジ詳細
 */
export function collectTestCoverage(
  files: FileInfo[],
  featureAreas: { name: string; keywords: string[] }[],
): AnalysisResult['testCoverage'] {
  const testFiles = files.filter((f) => f.relativePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/));
  const sourceFiles = files.filter(
    (f) =>
      (f.ext === '.ts' || f.ext === '.tsx') &&
      !f.relativePath.match(/\.(test|spec)\./) &&
      !f.relativePath.includes('__tests__'),
  );

  const details = featureAreas.map((area) => {
    const matchesKeyword = (path: string) =>
      area.keywords.some((kw) => path.toLowerCase().includes(kw));

    const areaSourceFiles = sourceFiles
      .filter((f) => matchesKeyword(f.relativePath))
      .map((f) => f.relativePath);
    const areaTestFiles = testFiles
      .filter((f) => matchesKeyword(f.relativePath))
      .map((f) => f.relativePath);

    // Find untested source files (no corresponding test file)
    const testedPatterns = areaTestFiles.map((t) => {
      const base = basename(t).replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '');
      return base.toLowerCase();
    });

    const untestedFiles = areaSourceFiles.filter((src) => {
      const srcBase = basename(src, extname(src)).toLowerCase();
      return !testedPatterns.some(
        (tp) => tp === srcBase || srcBase.includes(tp) || tp.includes(srcBase),
      );
    });

    const coverageRatio =
      areaSourceFiles.length > 0
        ? Math.round(
            ((areaSourceFiles.length - untestedFiles.length) / areaSourceFiles.length) * 100,
          ) / 100
        : 1;

    return {
      featureName: area.name,
      sourceFiles: areaSourceFiles,
      testFiles: areaTestFiles,
      untestedFiles,
      coverageRatio,
    };
  });

  // Find critical untested files (large source files without tests)
  const criticalUntested = sourceFiles
    .filter((f) => f.lines > 200)
    .filter((f) => {
      const srcBase = basename(f.relativePath, extname(f.relativePath)).toLowerCase();
      return !testFiles.some((t) => {
        const testBase = basename(t.relativePath)
          .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '')
          .toLowerCase();
        return testBase === srcBase || srcBase.includes(testBase) || testBase.includes(srcBase);
      });
    })
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 20)
    .map((f) => `${f.relativePath} (${f.lines} lines)`);

  const totalSource = details.reduce((sum, d) => sum + d.sourceFiles.length, 0);
  const totalUntested = details.reduce((sum, d) => sum + d.untestedFiles.length, 0);
  const overallCoverageRatio =
    totalSource > 0 ? Math.round(((totalSource - totalUntested) / totalSource) * 100) / 100 : 1;

  return {
    details,
    overallCoverageRatio,
    untestedCriticalFiles: criticalUntested,
  };
}
