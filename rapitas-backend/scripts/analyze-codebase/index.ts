/**
 * analyze-codebase/index
 *
 * Entry point for the Rapitas Codebase Analysis Script (Enhanced v2).
 * Orchestrates all metric collectors, assembles the AnalysisResult, and
 * writes analysis-result.json and analysis-report.md to the project root.
 *
 * Usage: bun run rapitas-backend/scripts/analyze-codebase.ts
 * No external dependencies — uses Node.js built-in APIs only.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../config/logger';
import { PROJECT_ROOT } from './constants';
import { walkDir } from './file-walker';
import { collectCodeMetrics } from './metrics/code-metrics';
import { collectArchitectureMetrics } from './metrics/architecture-metrics';
import { collectQualityMetrics } from './metrics/quality-metrics';
import { collectComplexityMetrics } from './metrics/complexity-metrics';
import { collectSecurityFindings } from './metrics/security-metrics';
import { collectImportMetrics } from './metrics/import-metrics';
import { collectAPIConsistency } from './metrics/api-consistency';
import { collectTestCoverage, FEATURE_AREAS_CONFIG } from './metrics/test-coverage';
import { collectArchitectureHealth } from './metrics/architecture-health';
import { collectAIAgentMetrics, collectDependencyMetrics } from './metrics/ai-agent-metrics';
import { collectFeatureCompleteness } from './metrics/feature-completeness';
import { collectMaintainabilityMetrics } from './metrics/maintainability-metrics';
import { computeScoring } from './scoring';
import { generateMarkdownReport } from './report-generator';
import { generateAgentReport, renderAgentReportMarkdown } from './agent-report-generator';
import type { AnalysisResult } from './types';

const log = createLogger('analyze-codebase');

async function main() {
  const startTime = Date.now();
  log.info('Rapitas Codebase Analysis (v3 - Strict Scoring) - Starting...');
  log.info(`Project root: ${PROJECT_ROOT}`);

  log.info('Scanning files...');
  const files = walkDir(PROJECT_ROOT);
  log.info(`Found ${files.length} files`);

  log.info('Collecting code metrics...');
  const codeMetrics = collectCodeMetrics(files);

  log.info('Collecting architecture metrics...');
  const architecture = collectArchitectureMetrics(files);

  log.info('Collecting quality metrics...');
  const quality = collectQualityMetrics(files);

  log.info('Collecting complexity metrics...');
  const complexityMetrics = collectComplexityMetrics(files);

  log.info('Collecting security findings...');
  const securityFindings = collectSecurityFindings(files);

  log.info('Collecting import metrics...');
  const importMetrics = collectImportMetrics(files);

  log.info('Collecting API consistency...');
  const apiConsistency = collectAPIConsistency(architecture.backend.endpoints);

  log.info('Collecting test coverage details...');
  const testCoverage = collectTestCoverage(files, FEATURE_AREAS_CONFIG);

  log.info('Collecting architecture health...');
  const archHealth = collectArchitectureHealth(files, importMetrics);

  log.info('Collecting AI/agent metrics...');
  const aiAgent = collectAIAgentMetrics(files);

  log.info('Collecting dependency metrics...');
  const deps = collectDependencyMetrics();

  log.info('Collecting feature completeness...');
  const featureCompleteness = collectFeatureCompleteness(files, architecture);

  log.info('Collecting maintainability metrics...');
  const maintainabilityMetrics = collectMaintainabilityMetrics(files, complexityMetrics);

  log.info('Computing scores...');
  const scoring = computeScoring(
    quality,
    featureCompleteness,
    architecture,
    codeMetrics,
    complexityMetrics,
    securityFindings,
    apiConsistency,
    archHealth,
    maintainabilityMetrics,
  );

  const executionTimeMs = Date.now() - startTime;

  const result: AnalysisResult = {
    metadata: {
      generatedAt: new Date().toISOString(),
      executionTimeMs,
      projectRoot: PROJECT_ROOT,
      version: '3.0.0',
    },
    codeMetrics,
    architecture,
    quality,
    complexity: complexityMetrics,
    security: securityFindings,
    imports: importMetrics,
    apiConsistency,
    testCoverage,
    architectureHealth: archHealth,
    maintainability: maintainabilityMetrics,
    aiAgent,
    dependencies: deps,
    featureCompleteness,
    scoring,
  };

  log.info('Generating outputs...');
  const jsonPath = join(PROJECT_ROOT, 'analysis-result.json');
  const mdPath = join(PROJECT_ROOT, 'analysis-report.md');
  const agentMdPath = join(PROJECT_ROOT, 'analysis-for-agent.md');

  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
  log.info(`JSON output: ${jsonPath}`);

  const report = generateMarkdownReport(result);
  writeFileSync(mdPath, report, 'utf-8');
  log.info(`Markdown report: ${mdPath}`);

  log.info('Generating AI agent-optimized report...');
  const agentReport = generateAgentReport(result);
  const agentMarkdown = renderAgentReportMarkdown(agentReport);
  writeFileSync(agentMdPath, agentMarkdown, 'utf-8');
  log.info(`AI agent report: ${agentMdPath}`);

  log.info('=== Analysis Complete ===');
  log.info(`Total files: ${codeMetrics.totalFiles}`);
  log.info(`Total lines: ${codeMetrics.totalLines.toLocaleString()}`);
  log.info(`Endpoints: ${architecture.backend.endpoints.length}`);
  log.info(`Prisma models: ${architecture.prisma.modelCount}`);
  log.info(`God objects: ${complexityMetrics.godObjects.length}`);
  log.info(
    `Security findings: ${securityFindings.findings.length} (high: ${securityFindings.summary.high})`,
  );
  log.info(`Circular deps: ${importMetrics.circularDependencies.length}`);
  log.info(`Layer violations: ${archHealth.layerViolations.length}`);
  log.info(`Overall score: ${scoring.overallScore}/100`);
  log.info(`  Quality: ${scoring.qualityScore}/100`);
  log.info(`  Maintainability: ${scoring.maintainabilityScore}/100`);
  log.info(`  Architecture: ${scoring.architectureScore}/100`);
  log.info(`  Features: ${scoring.featureCoverageScore}/100`);
  log.info(`  Security: ${scoring.securityScore}/100`);
  log.info(`  Code duplication: ${(maintainabilityMetrics.duplicationRatio * 100).toFixed(1)}%`);
  log.info(`--- AI Agent Report ---`);
  log.info(`  Action items: ${agentReport.summary.totalIssues}`);
  log.info(`  Critical: ${agentReport.summary.criticalCount}`);
  log.info(`  Quick wins: ${agentReport.quickWins.length}`);
  log.info(`  Estimated effort: ${agentReport.summary.estimatedTotalEffort}`);
  log.info(`Execution time: ${executionTimeMs}ms`);
}

main().catch((err) => {
  log.error({ err }, 'Analysis failed');
  process.exit(1);
});
