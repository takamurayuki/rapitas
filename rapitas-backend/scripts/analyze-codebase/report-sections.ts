/**
 * analyze-codebase/report-sections
 *
 * Individual Markdown section renderers used by report-generator.ts.
 * Each function returns a Markdown string fragment for one section of the
 * analysis report. Kept separate to keep report-generator.ts under 300 lines.
 */

import { THRESHOLDS } from './constants';
import type { AnalysisResult, MaintainabilityMetrics } from './types';

/** Maps a severity string to a bracketed label for Markdown tables. */
export function severityLabel(s: string): string {
  switch (s) {
    case 'critical':
      return '[CRITICAL]';
    case 'high':
      return '[HIGH]';
    case 'warning':
      return '[WARN]';
    case 'medium':
      return '[MEDIUM]';
    case 'low':
      return '[LOW]';
    case 'info':
      return '[INFO]';
    default:
      return '';
  }
}

/** Formats a byte count as B / KB / MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders the complexity analysis section (god objects, warnings, long functions).
 *
 * @param complexity - Complexity metrics / 複雑度メトリクス
 * @returns Markdown section string / Markdownセクション文字列
 */
export function renderComplexitySection(complexity: AnalysisResult['complexity']): string {
  return `## 2. Complexity Analysis

### God Objects (${complexity.godObjects.length} detected)
${
  complexity.godObjects.length > 0
    ? complexity.godObjects.map((g) => `- \`${g}\``).join('\n')
    : 'None detected'
}

### Complexity Warnings (${complexity.warnings.length} total)
${
  complexity.warnings.length > 0
    ? `| Severity | File | Type | Message |
|----------|------|------|---------|
${complexity.warnings
  .slice(0, 30)
  .map((w) => `| ${severityLabel(w.severity)} | \`${w.file}\` | ${w.type} | ${w.message} |`)
  .join('\n')}`
    : 'No warnings'
}

### Long Functions (> ${THRESHOLDS.maxFunctionLines} lines)
${
  complexity.longFunctions.length > 0
    ? `| File | Function | Lines |
|------|----------|-------|
${complexity.longFunctions.map((f) => `| \`${f.file}\` | ${f.name} | ${f.lines} |`).join('\n')}`
    : 'None detected'
}

---
`;
}

/**
 * Renders the security analysis section.
 *
 * @param security - Security findings / セキュリティ検出結果
 * @param securityScore - Computed security score / セキュリティスコア
 * @returns Markdown section string / Markdownセクション文字列
 */
export function renderSecuritySection(
  security: AnalysisResult['security'],
  securityScore: number,
): string {
  return `## 3. Security Analysis

### Summary
| Severity | Count |
|----------|-------|
| High/Critical | ${security.summary.high} |
| Medium | ${security.summary.medium} |
| Low | ${security.summary.low} |
| **Security Score** | **${securityScore}/100** |

${
  security.findings.length > 0
    ? `### Findings
| Severity | File | Line | Type | Message |
|----------|------|------|------|---------|
${security.findings
  .slice(0, 30)
  .map(
    (f) =>
      `| ${severityLabel(f.severity)} | \`${f.file}\` | ${f.line} | ${f.type} | ${f.message} |`,
  )
  .join('\n')}`
    : 'No security issues detected'
}

---
`;
}

/**
 * Renders the maintainability section including duplication blocks.
 *
 * @param maintainability - Maintainability metrics / 保守性指標
 * @param maintainabilityScore - Computed maintainability score / 保守性スコア
 * @returns Markdown section string / Markdownセクション文字列
 */
export function renderMaintainabilitySection(
  maintainability: MaintainabilityMetrics,
  maintainabilityScore: number,
): string {
  let md = `## 4. Maintainability

| Metric | Value |
|--------|-------|
| File Size Score | ${maintainability.fileSizeScore}% (files <= 500 lines) |
| Function Length Score | ${maintainability.functionLengthScore}% |
| Nesting Score | ${maintainability.nestingScore}/100 |
| Duplication Score | ${maintainability.duplicationScore}/100 |
| Duplicated Lines | ${maintainability.totalDuplicatedLines.toLocaleString()} (${(maintainability.duplicationRatio * 100).toFixed(1)}%) |
| Avg Cyclomatic Complexity | ${maintainability.avgCyclomaticComplexity} |
| **Maintainability Score** | **${maintainabilityScore}/100** |

`;

  if (maintainability.duplicatedBlocks.length > 0) {
    md += `### Top Duplicated Blocks
| # | Files | Locations |
|---|-------|-----------|
`;
    maintainability.duplicatedBlocks.slice(0, 15).forEach((d, i) => {
      const locs = d.files.map((f) => '`' + f.path + ':' + f.startLine + '`').join(', ');
      md += `| ${i + 1} | ${d.files.length} files | ${locs} |\n`;
    });
  } else {
    md += 'No significant code duplication detected\n';
  }

  return md + '\n---\n';
}

/**
 * Renders the architecture health and API consistency sections.
 *
 * @param architecture - Architecture metrics / アーキテクチャ集計
 * @param architectureHealth - Architecture health scores / アーキテクチャ健全性
 * @param apiConsistency - API consistency analysis / API一貫性分析
 * @param imports - Import graph statistics / インポートグラフ統計
 * @returns Markdown section string / Markdownセクション文字列
 */
export function renderArchitectureSection(
  architecture: AnalysisResult['architecture'],
  architectureHealth: AnalysisResult['architectureHealth'],
  apiConsistency: AnalysisResult['apiConsistency'],
  imports: AnalysisResult['imports'],
): string {
  return `## 5. Architecture

### Backend
- **Route files**: ${architecture.backend.routeFiles}
- **Endpoints**: ${architecture.backend.endpoints.length}
- **Services**: ${architecture.backend.services.length}

### Prisma Models
- **Models**: ${architecture.prisma.modelCount}
- **Relations**: ${architecture.prisma.totalRelations}
${
  architecture.prisma.oversizedModels.length > 0
    ? `- **Oversized models** (> ${THRESHOLDS.maxFieldsPerModel} fields): ${architecture.prisma.oversizedModels.map((m) => `${m.name}(${m.fieldCount})`).join(', ')}`
    : ''
}

### Frontend
${architecture.frontend.components.map((c) => `- **${c.category}**: ${c.count} files`).join('\n')}
- **Custom hooks**: ${architecture.frontend.hooks.length}
- **Stores**: ${architecture.frontend.stores.length}
- **Page routes**: ${architecture.frontend.pages.length}

### Architecture Health
| Metric | Score |
|--------|-------|
| Coupling Score | ${architectureHealth.couplingScore}/100 (lower coupling = better) |
| Cohesion Score | ${architectureHealth.cohesionScore}/100 |
| Modularity | ${architectureHealth.modularity}% |
| Layer Violations | ${architectureHealth.layerViolations.length} |

${
  architectureHealth.layerViolations.length > 0
    ? `#### Layer Violations
| File | Issue |
|------|-------|
${architectureHealth.layerViolations.map((v) => `| \`${v.file}\` | ${v.message} |`).join('\n')}`
    : ''
}

---

## 6. API Consistency

- **REST Conformance Score**: ${apiConsistency.restConformanceScore}/100
- **Issues**: ${apiConsistency.issues.length}
- **Duplicate endpoints**: ${apiConsistency.duplicateEndpoints.length}

${
  apiConsistency.duplicateEndpoints.length > 0
    ? `### Duplicate Endpoints
| Endpoint | Files |
|----------|-------|
${apiConsistency.duplicateEndpoints.map((d) => `| \`${d.path}\` | ${d.files.map((f) => `\`${f}\``).join(', ')} |`).join('\n')}`
    : ''
}

${
  apiConsistency.issues.length > 0
    ? `<details>
<summary>API Issues (${apiConsistency.issues.length})</summary>

| Endpoint | Type | Message |
|----------|------|---------|
${apiConsistency.issues
  .slice(0, 30)
  .map((i) => `| \`${i.endpoint}\` | ${i.type} | ${i.message} |`)
  .join('\n')}

</details>`
    : ''
}

---

## 7. Import Graph

- **Circular dependencies**: ${imports.circularDependencies.length}
- **High fan-out files**: ${imports.highFanOutFiles.length}
- **High fan-in files**: ${imports.highFanInFiles.length}

${
  imports.circularDependencies.length > 0
    ? `### Circular Dependencies
${imports.circularDependencies
  .slice(0, 10)
  .map((c) => `- ${c.cycle.join(' -> ')}`)
  .join('\n')}`
    : 'No circular dependencies detected'
}

${
  imports.highFanOutFiles.length > 0
    ? `### High Fan-Out (many imports)
| File | Import Count |
|------|-------------|
${imports.highFanOutFiles
  .slice(0, 10)
  .map((f) => `| \`${f.file}\` | ${f.importCount} |`)
  .join('\n')}`
    : ''
}

---
`;
}
