/**
 * analyze-codebase/report-generator
 *
 * Renders a complete Markdown analysis report from a fully populated
 * AnalysisResult object. Delegates complex sections to report-sections.ts.
 * Responsible only for assembling the report — no analysis logic here.
 */

import type { AnalysisResult } from './types';
import {
  formatBytes,
  renderComplexitySection,
  renderSecuritySection,
  renderMaintainabilitySection,
  renderArchitectureSection,
} from './report-sections';

/**
 * Generates a Markdown report string from analysis results.
 *
 * @param result - Complete analysis result object / 分析結果オブジェクト
 * @returns Full Markdown report text / Markdownレポート文字列
 */
export function generateMarkdownReport(result: AnalysisResult): string {
  const {
    metadata,
    codeMetrics,
    architecture,
    quality,
    aiAgent,
    dependencies,
    featureCompleteness,
    scoring,
    complexity,
    security,
    imports,
    apiConsistency,
    testCoverage,
    architectureHealth,
    maintainability,
  } = result;

  let md = `# Rapitas Codebase Analysis Report (v${metadata.version})

> Generated: ${metadata.generatedAt}
> Execution time: ${metadata.executionTimeMs}ms
> Project root: \`${metadata.projectRoot}\`

---

## Summary Dashboard

| Metric | Score |
|--------|-------|
| Overall Score | **${scoring.overallScore}/100** |
| Quality Score | ${scoring.qualityScore}/100 |
| Maintainability Score | ${scoring.maintainabilityScore}/100 |
| Architecture Score | ${scoring.architectureScore}/100 |
| Feature Coverage | ${scoring.featureCoverageScore}/100 |
| Security Score | ${scoring.securityScore}/100 |

---

## 1. Code Metrics

### Summary
| Item | Value |
|------|-------|
| Total files | ${codeMetrics.totalFiles} |
| Total lines | ${codeMetrics.totalLines.toLocaleString()} |
| Total size | ${formatBytes(codeMetrics.totalSize)} |
| Avg file lines | ${complexity.avgFileLines} |
| Median file lines | ${complexity.medianFileLines} |
| Files > 500 lines | ${complexity.filesOver500Lines} |
| Files > 1000 lines | ${complexity.filesOver1000Lines} |

### By Extension
| Extension | Files | Lines | Size | Avg Lines |
|-----------|-------|-------|------|-----------|
${codeMetrics.byExtension.map((e) => `| ${e.extension} | ${e.fileCount} | ${e.totalLines.toLocaleString()} | ${formatBytes(e.totalSize)} | ${e.avgLines} |`).join('\n')}

### By Directory
| Directory | Files | Lines | Size |
|-----------|-------|-------|------|
${Object.entries(codeMetrics.byDirectory)
  .sort(([, a], [, b]) => b.lines - a.lines)
  .map(([dir, d]) => `| ${dir} | ${d.files} | ${d.lines.toLocaleString()} | ${formatBytes(d.size)} |`)
  .join('\n')}

### Largest Files Top20
| # | File | Lines | Size |
|---|------|-------|------|
${codeMetrics.largestFiles.map((f, i) => `| ${i + 1} | \`${f.path}\` | ${f.lines.toLocaleString()} | ${formatBytes(f.size)} |`).join('\n')}

---

`;

  md += renderComplexitySection(complexity);
  md += renderSecuritySection(security, scoring.securityScore);
  md += renderMaintainabilitySection(maintainability, scoring.maintainabilityScore);
  md += renderArchitectureSection(architecture, architectureHealth, apiConsistency, imports);

  md += `## 8. Quality Metrics

| Metric | Value |
|--------|-------|
| Test files | ${quality.testFiles} |
| Source files | ${quality.sourceFiles} |
| Test ratio | ${(quality.testRatio * 100).toFixed(1)}% |
| \`any\` usage | ${quality.anyUsage} |
| TODO comments | ${quality.todoCount} |
| FIXME comments | ${quality.fixmeCount} |
| HACK comments | ${quality.hackCount} |
| console.log | ${quality.consoleLogCount} |
| try/catch blocks | ${quality.tryCatchCount} |
| Empty catch blocks | ${quality.emptyTryCatchCount} |
| Test assertions | ${quality.assertionCount} |
| Assertions/test file | ${quality.testFiles > 0 ? (quality.assertionCount / quality.testFiles).toFixed(1) : 'N/A'} |

---

## 9. Test Coverage Details

**Overall test coverage ratio**: ${(testCoverage.overallCoverageRatio * 100).toFixed(1)}%

### Per-Feature Coverage
| Feature | Source Files | Test Files | Untested | Coverage |
|---------|------------|------------|----------|----------|
${testCoverage.details.map((d) => `| ${d.featureName} | ${d.sourceFiles.length} | ${d.testFiles.length} | ${d.untestedFiles.length} | ${(d.coverageRatio * 100).toFixed(0)}% |`).join('\n')}

### Critical Untested Files (large files without tests)
${
  testCoverage.untestedCriticalFiles.length > 0
    ? testCoverage.untestedCriticalFiles.map((f) => `- \`${f}\``).join('\n')
    : 'All critical files have tests'
}

---

## 10. Feature Completeness

| Area | Routes | Services | Components | Hooks | Models | Tests | Untested | Score |
|------|--------|----------|------------|-------|--------|-------|----------|-------|
${featureCompleteness.map((f) => `| ${f.name} | ${f.routes} | ${f.services} | ${f.components} | ${f.hooks} | ${f.models} | ${f.tests} | ${f.untestedSourceFiles.length} | **${f.score}/100** |`).join('\n')}

**Average feature coverage: ${scoring.featureCoverageScore}/100**

---

## 11. AI/Agent System

| Item | Value |
|------|-------|
| AI Providers | ${aiAgent.providers.join(', ') || 'None'} |
| Agent Types | ${aiAgent.agentTypes.length > 0 ? aiAgent.agentTypes.join(', ') : '(dynamic)'} |
| Agent Routes | ${aiAgent.agentRoutes.length} |
| Agent Services | ${aiAgent.agentServices.length} |

---

## 12. Dependencies

| Package | Production | Dev | Total |
|---------|-----------|-----|-------|
| Backend | ${dependencies.backend.production} | ${dependencies.backend.dev} | ${dependencies.backend.total} |
| Frontend | ${dependencies.frontend.production} | ${dependencies.frontend.dev} | ${dependencies.frontend.total} |
| **Total** | **${dependencies.backend.production + dependencies.frontend.production}** | **${dependencies.backend.dev + dependencies.frontend.dev}** | **${dependencies.backend.total + dependencies.frontend.total}** |

---

## 13. Overall Assessment

### Scores
| Metric | Score |
|--------|-------|
| Overall | **${scoring.overallScore}/100** |
| Quality | ${scoring.qualityScore}/100 |
| Maintainability | ${scoring.maintainabilityScore}/100 |
| Architecture | ${scoring.architectureScore}/100 |
| Feature Coverage | ${scoring.featureCoverageScore}/100 |
| Security | ${scoring.securityScore}/100 |

### Strengths
${scoring.strengths.length > 0 ? scoring.strengths.map((s) => `- ${s}`).join('\n') : '- None'}

### Weaknesses
${scoring.weaknesses.length > 0 ? scoring.weaknesses.map((w) => `- ${w}`).join('\n') : '- None'}

### Improvement Suggestions (Prioritized)
${scoring.suggestions.length > 0 ? scoring.suggestions.map((s) => `- ${s}`).join('\n') : '- None'}

---

## 14. AI Evaluation Prompt

Use the following prompt with \`analysis-result.json\` for detailed AI evaluation:

\`\`\`
Below are the automated analysis results for the Rapitas project codebase.
Based on this data, please provide evaluations and proposals from the following perspectives:

1. Architecture maturity (1-10) and rationale
2. Code quality evaluation (1-10) and specific improvement areas
3. Feature completeness evaluation (1-10) and missing features
4. Technical debt identification and prioritized resolution plan
5. Scalability evaluation and improvement proposals
6. Security risk identification
7. Top 5 tasks to tackle in the next development sprint

[Paste the contents of analysis-result.json here]
\`\`\`
`;

  return md;
}
