/**
 * analyze-codebase/scoring
 *
 * Computes multi-dimensional quality scores (v3 strict scoring — no base scores,
 * every point is earned). Weights: Quality 25% | Maintainability 20% |
 * Architecture 20% | Features 15% | Security 20%.
 * Also generates human-readable strengths, weaknesses, and suggestions.
 */

import type {
  FeatureArea,
  ArchitectureHealth,
  MaintainabilityMetrics,
  AnalysisResult,
} from './types';

/**
 * Computes all scoring dimensions and generates textual assessment.
 *
 * @param quality - Quality metric counters / コード品質カウント
 * @param features - Feature completeness scores / フィーチャー完成度
 * @param arch - Architecture metrics / アーキテクチャ集計
 * @param codeMetrics - Code size metrics / コードサイズ集計
 * @param complexity - Complexity analysis results / 複雑度分析
 * @param security - Security finding summary / セキュリティ検出結果
 * @param apiConsistency - API consistency analysis / API一貫性分析
 * @param archHealth - Architecture health scores / アーキテクチャ健全性
 * @param maintainability - Maintainability sub-scores / 保守性指標
 * @returns Full scoring result with strengths, weaknesses, and suggestions / スコアリング結果
 */
export function computeScoring(
  quality: AnalysisResult['quality'],
  features: FeatureArea[],
  arch: AnalysisResult['architecture'],
  codeMetrics: AnalysisResult['codeMetrics'],
  complexity: AnalysisResult['complexity'],
  security: AnalysisResult['security'],
  apiConsistency: AnalysisResult['apiConsistency'],
  archHealth: ArchitectureHealth,
  maintainability: MaintainabilityMetrics,
): AnalysisResult['scoring'] {
  // ── Quality Score (0-100, earned only) ──

  let qualityScore = 0;

  // Test coverage (0-35 pts)
  const testCoveragePoints = Math.min(35, Math.round(quality.testRatio * 70));
  qualityScore += testCoveragePoints;

  // Assertion quality (0-15 pts)
  const assertionsPerTest = quality.testFiles > 0 ? quality.assertionCount / quality.testFiles : 0;
  if (assertionsPerTest >= 10) qualityScore += 15;
  else if (assertionsPerTest >= 5) qualityScore += 10;
  else if (assertionsPerTest >= 3) qualityScore += 7;
  else if (assertionsPerTest >= 1) qualityScore += 3;

  // Type safety (0-20 pts)
  const anyPer1000 = quality.anyUsage / (codeMetrics.totalLines / 1000);
  if (anyPer1000 < 0.1) qualityScore += 20;
  else if (anyPer1000 < 0.5) qualityScore += 15;
  else if (anyPer1000 < 1) qualityScore += 10;
  else if (anyPer1000 < 3) qualityScore += 5;

  // Code hygiene (0-15 pts)
  if (quality.consoleLogCount === 0) qualityScore += 8;
  else if (quality.consoleLogCount < 5) qualityScore += 5;
  else if (quality.consoleLogCount < 20) qualityScore += 2;

  if (quality.todoCount + quality.fixmeCount + quality.hackCount === 0) qualityScore += 7;
  else if (quality.todoCount + quality.fixmeCount + quality.hackCount < 5) qualityScore += 4;
  else if (quality.todoCount + quality.fixmeCount + quality.hackCount < 15) qualityScore += 2;

  // Empty catch blocks penalty (0 to -15)
  if (quality.emptyTryCatchCount > 20) qualityScore -= 15;
  else if (quality.emptyTryCatchCount > 10) qualityScore -= 10;
  else if (quality.emptyTryCatchCount > 5) qualityScore -= 5;
  else if (quality.emptyTryCatchCount > 0) qualityScore -= 2;

  // God objects penalty (0 to -15)
  if (complexity.godObjects.length > 5) qualityScore -= 15;
  else if (complexity.godObjects.length > 2) qualityScore -= 10;
  else if (complexity.godObjects.length > 0) qualityScore -= 5;

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  // ── Maintainability Score (0-100) ──
  const maintainabilityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        maintainability.fileSizeScore * 0.25 +
          maintainability.functionLengthScore * 0.2 +
          maintainability.nestingScore * 0.15 +
          maintainability.duplicationScore * 0.25 +
          Math.max(
            0,
            Math.min(100, Math.round(150 - maintainability.avgCyclomaticComplexity * 2.5)),
          ) *
            0.15,
      ),
    ),
  );

  // ── Feature Coverage Score (0-100, quality-weighted) ──
  const featureScores = features.map((f) => {
    const rawScore = f.score;
    const featureTestRatio =
      f.untestedSourceFiles.length > 0 && f.routes + f.services + f.components + f.hooks > 0
        ? 1 -
          f.untestedSourceFiles.length /
            (f.routes + f.services + f.components + f.hooks + f.untestedSourceFiles.length)
        : 1;
    // Quality multiplier: 0.5 (no tests) → 1.0 (full coverage)
    const qualityMultiplier = 0.5 + featureTestRatio * 0.5;
    return Math.round(rawScore * qualityMultiplier);
  });
  const featureCoverageScore = Math.round(
    featureScores.reduce((sum, s) => sum + s, 0) / featureScores.length,
  );

  // ── Architecture Score (0-100) ──
  let architectureScore = 0;

  // REST conformance (0-25 pts)
  architectureScore += Math.round(apiConsistency.restConformanceScore * 0.25);

  // Layer separation (0-25 pts)
  if (archHealth.layerViolations.length === 0) architectureScore += 25;
  else if (archHealth.layerViolations.length <= 2) architectureScore += 15;
  else if (archHealth.layerViolations.length <= 5) architectureScore += 8;

  // Coupling/Cohesion (0-20 pts)
  architectureScore += Math.round(archHealth.couplingScore * 0.1);
  architectureScore += Math.round(archHealth.cohesionScore * 0.1);

  // Modularity (0-15 pts)
  if (archHealth.modularity > 70) architectureScore += 15;
  else if (archHealth.modularity > 50) architectureScore += 10;
  else if (archHealth.modularity > 30) architectureScore += 5;

  // Service layer presence (0-5 pts)
  if (arch.backend.services.length >= 10) architectureScore += 5;
  else if (arch.backend.services.length >= 5) architectureScore += 3;

  // God object penalty (0 to -10)
  if (complexity.godObjects.length > 3) architectureScore -= 10;
  else if (complexity.godObjects.length > 0) architectureScore -= 5;

  // Duplicate endpoints penalty (0 to -10)
  if (apiConsistency.duplicateEndpoints.length > 5) architectureScore -= 10;
  else if (apiConsistency.duplicateEndpoints.length > 0) architectureScore -= 5;

  // Oversized models penalty (0 to -5)
  if (arch.prisma.oversizedModels.length > 0) architectureScore -= 5;

  architectureScore = Math.max(0, Math.min(100, architectureScore));

  // ── Security Score (0-100) — starts at 100 with deductions ──
  const criticalFindings = security.findings.filter((f) => f.severity === 'critical').length;
  let securityScore = 100;
  securityScore -= criticalFindings * 25;
  securityScore -= (security.summary.high - criticalFindings) * 10;
  securityScore -= security.summary.medium * 4;
  securityScore -= security.summary.low * 1;
  securityScore = Math.max(0, Math.min(100, securityScore));

  // ── Overall Score ──
  const overallScore = Math.round(
    qualityScore * 0.25 +
      maintainabilityScore * 0.2 +
      architectureScore * 0.2 +
      featureCoverageScore * 0.15 +
      securityScore * 0.2,
  );

  // ── Strengths, Weaknesses, Suggestions ──
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];

  if (qualityScore >= 70) strengths.push(`High quality score (${qualityScore}/100)`);
  if (maintainabilityScore >= 70)
    strengths.push(`Good maintainability (${maintainabilityScore}/100)`);
  if (maintainability.duplicationRatio < 0.03)
    strengths.push(
      `Low code duplication (duplication ratio: ${(maintainability.duplicationRatio * 100).toFixed(1)}%)`,
    );
  if (quality.anyUsage < 20)
    strengths.push(`High type safety (any usage: ${quality.anyUsage} locations)`);
  if (quality.consoleLogCount < 10) strengths.push(`Log output is properly managed`);
  if (security.summary.high === 0) strengths.push(`No critical security risks detected`);
  if (archHealth.layerViolations.length === 0) strengths.push(`Proper inter-layer dependencies`);
  if (assertionsPerTest >= 5)
    strengths.push(
      `High test quality (average ${assertionsPerTest.toFixed(1)} assertions per test file)`,
    );

  const strongFeatures = features.filter((f) => f.score >= 75);
  if (strongFeatures.length > 0) {
    strengths.push(`High coverage features: ${strongFeatures.map((f) => f.name).join(', ')}`);
  }

  if (quality.testRatio < 0.3)
    weaknesses.push(
      `Insufficient test coverage (test ratio: ${(quality.testRatio * 100).toFixed(1)}%, recommended: 50%+)`,
    );
  if (maintainability.duplicationRatio > 0.05)
    weaknesses.push(
      `High code duplication (duplication ratio: ${(maintainability.duplicationRatio * 100).toFixed(1)}%, ${maintainability.totalDuplicatedLines} lines)`,
    );
  if (maintainability.fileSizeScore < 70)
    weaknesses.push(
      `Too many oversized files (files under 500 lines: ${maintainability.fileSizeScore}%)`,
    );
  if (maintainability.avgCyclomaticComplexity > 40)
    weaknesses.push(
      `High cyclomatic complexity (average: ${maintainability.avgCyclomaticComplexity})`,
    );
  if (quality.anyUsage > 50)
    weaknesses.push(`High usage of any type (${quality.anyUsage} locations)`);
  if (quality.emptyTryCatchCount > 0)
    weaknesses.push(
      `Empty catch blocks (${quality.emptyTryCatchCount} locations) - errors are being ignored`,
    );
  if (complexity.godObjects.length > 0)
    weaknesses.push(`God Object detected: ${complexity.godObjects.length} files`);
  if (complexity.filesOver1000Lines > 5)
    weaknesses.push(`${complexity.filesOver1000Lines} files over 1000 lines`);
  if (archHealth.layerViolations.length > 0)
    weaknesses.push(`Layer violations: ${archHealth.layerViolations.length} cases`);
  if (arch.prisma.oversizedModels.length > 0) {
    weaknesses.push(
      `Oversized Prisma models: ${arch.prisma.oversizedModels.map((m) => `${m.name}(${m.fieldCount} fields)`).join(', ')}`,
    );
  }

  const weakFeatures = features.filter((f) => f.score < 50);
  if (weakFeatures.length > 0) {
    weaknesses.push(`Low coverage features: ${weakFeatures.map((f) => f.name).join(', ')}`);
  }

  if (quality.testRatio < 0.3) {
    const untestedCount = features.reduce((sum, f) => sum + f.untestedSourceFiles.length, 0);
    suggestions.push(
      `[P0] Expand testing - ${untestedCount} untested source files (current ${(quality.testRatio * 100).toFixed(0)}% → target 50%+)`,
    );
  }
  if (maintainability.duplicationRatio > 0.05) {
    suggestions.push(
      `[P0] Eliminate code duplication - consolidate ${maintainability.duplicatedBlocks.length} duplicate blocks`,
    );
  }
  if (complexity.godObjects.length > 0) {
    suggestions.push(
      `[P0] God Object refactoring - split ${complexity.godObjects.slice(0, 3).join(', ')}`,
    );
  }
  if (complexity.filesOver1000Lines > 10) {
    suggestions.push(
      `[P0] Split large files - split ${complexity.filesOver1000Lines} files over 1000 lines to under 500 lines`,
    );
  }
  if (security.summary.high > 0) {
    suggestions.push(`[P0] Security fixes - fix ${security.summary.high} high-risk detections`);
  }
  if (quality.emptyTryCatchCount > 0) {
    suggestions.push(`[P1] Add error handling to ${quality.emptyTryCatchCount} empty catch blocks`);
  }
  if (archHealth.layerViolations.length > 0) {
    suggestions.push(
      `[P1] Fix layer violations - fix ${archHealth.layerViolations.length} improper imports`,
    );
  }
  if (arch.prisma.oversizedModels.length > 0) {
    suggestions.push(
      `[P2] Normalize oversized Prisma models (${arch.prisma.oversizedModels[0]?.name}: ${arch.prisma.oversizedModels[0]?.fieldCount} fields)`,
    );
  }
  if (weakFeatures.length > 0) {
    suggestions.push(`[P2] Feature enhancement: ${weakFeatures.map((f) => f.name).join(', ')}`);
  }

  return {
    qualityScore,
    maintainabilityScore,
    featureCoverageScore,
    architectureScore,
    securityScore,
    overallScore,
    strengths,
    weaknesses,
    suggestions,
  };
}
