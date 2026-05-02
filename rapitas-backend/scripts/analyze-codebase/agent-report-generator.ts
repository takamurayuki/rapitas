/**
 * analyze-codebase/agent-report-generator
 *
 * Generates an AI-agent-optimized report that provides:
 * - Prioritized, actionable task list with clear instructions
 * - File context and dependencies for each issue
 * - No redundant investigation needed — all context included
 *
 * Output format is designed for direct consumption by AI coding agents.
 */

import type { AnalysisResult, ComplexityWarning, SecurityFinding } from './types';

interface ActionItem {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  files: string[];
  estimatedEffort: 'small' | 'medium' | 'large';
  dependencies?: string[];
  acceptanceCriteria: string[];
  codeContext?: string;
}

interface AgentReport {
  summary: {
    totalIssues: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    estimatedTotalEffort: string;
  };
  actionItems: ActionItem[];
  fileIndex: Record<string, { issues: string[]; dependencies: string[]; dependents: string[] }>;
  quickWins: ActionItem[];
  blockers: ActionItem[];
}

/**
 * Calculates priority score for sorting (lower = higher priority)
 */
function getPriorityScore(priority: ActionItem['priority']): number {
  switch (priority) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
  }
}

/**
 * Generates action items from complexity warnings
 */
function generateComplexityActions(result: AnalysisResult): ActionItem[] {
  const actions: ActionItem[] = [];
  const { complexity } = result;

  // God objects - critical priority
  for (const file of complexity.godObjects) {
    const warning = complexity.warnings.find((w) => w.file === file && w.type === 'god_object');
    const lines = warning?.lines ?? 0;

    actions.push({
      id: `complexity-god-${file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: 'critical',
      category: 'Complexity',
      title: `Split god object: ${file}`,
      description: `This file has ${lines} lines and exhibits god object characteristics. It handles too many responsibilities and should be split into smaller, focused modules.`,
      files: [file],
      estimatedEffort: 'large',
      acceptanceCriteria: [
        'File is split into 3+ smaller modules with single responsibilities',
        'Each resulting file is under 300 lines',
        'All imports are updated across the codebase',
        'Tests pass after refactoring',
      ],
      codeContext: generateSplitSuggestion(file, result),
    });
  }

  // Critical size files
  const criticalFiles = complexity.warnings.filter((w) => w.type === 'critical_size');
  for (const warning of criticalFiles) {
    if (complexity.godObjects.includes(warning.file)) continue; // Already handled

    actions.push({
      id: `complexity-critical-${warning.file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: 'high',
      category: 'Complexity',
      title: `Reduce file size: ${warning.file}`,
      description: `File has ${warning.lines} lines (threshold: 2000). Extract reusable logic into separate modules.`,
      files: [warning.file],
      estimatedEffort: 'medium',
      acceptanceCriteria: [
        'File is reduced to under 500 lines',
        'Extracted modules have clear single responsibilities',
        'No functionality is lost',
      ],
    });
  }

  // Long functions
  for (const fn of complexity.longFunctions.slice(0, 10)) {
    // Top 10 only
    actions.push({
      id: `complexity-fn-${fn.file.replace(/[^a-zA-Z0-9]/g, '-')}-${fn.name}`,
      priority: fn.lines > 300 ? 'high' : 'medium',
      category: 'Complexity',
      title: `Refactor long function: ${fn.name} in ${fn.file}`,
      description: `Function "${fn.name}" has ${fn.lines} lines. Break it down into smaller, testable functions.`,
      files: [fn.file],
      estimatedEffort: fn.lines > 300 ? 'medium' : 'small',
      acceptanceCriteria: [
        `Function is split into multiple functions under 50 lines each`,
        'Each extracted function has a clear, descriptive name',
        'Unit tests are added for new functions',
      ],
    });
  }

  // Deep nesting
  const deepNesting = complexity.warnings.filter((w) => w.type === 'deep_nesting');
  for (const warning of deepNesting.slice(0, 5)) {
    actions.push({
      id: `complexity-nesting-${warning.file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: 'medium',
      category: 'Complexity',
      title: `Reduce nesting depth: ${warning.file}`,
      description: warning.message,
      files: [warning.file],
      estimatedEffort: 'small',
      acceptanceCriteria: [
        'Maximum nesting depth is reduced to 4 or less',
        'Early returns are used where appropriate',
        'Complex conditions are extracted to named functions',
      ],
    });
  }

  return actions;
}

/**
 * Generates action items from security findings
 */
function generateSecurityActions(result: AnalysisResult): ActionItem[] {
  const actions: ActionItem[] = [];
  const { security } = result;

  // Group by type
  const byType = new Map<string, SecurityFinding[]>();
  for (const finding of security.findings) {
    const existing = byType.get(finding.type) ?? [];
    existing.push(finding);
    byType.set(finding.type, existing);
  }

  for (const [type, findings] of byType) {
    const files = [...new Set(findings.map((f) => f.file))];
    const severity = findings[0].severity;

    actions.push({
      id: `security-${type}`,
      priority: severity === 'high' || severity === 'critical' ? 'critical' : 'high',
      category: 'Security',
      title: `Fix ${type.replace(/_/g, ' ')}: ${findings.length} occurrences`,
      description: findings[0].message,
      files,
      estimatedEffort: findings.length > 5 ? 'medium' : 'small',
      acceptanceCriteria: [
        `All ${findings.length} instances are fixed`,
        'Input validation is added where necessary',
        'Security tests are added to prevent regression',
      ],
      codeContext: findings
        .slice(0, 3)
        .map((f) => `// ${f.file}:${f.line}\n${f.snippet}`)
        .join('\n\n'),
    });
  }

  return actions;
}

/**
 * Generates action items from test coverage gaps
 */
function generateTestCoverageActions(result: AnalysisResult): ActionItem[] {
  const actions: ActionItem[] = [];
  const { testCoverage } = result;

  // Critical untested files
  for (const file of testCoverage.untestedCriticalFiles.slice(0, 10)) {
    const match = file.match(/\((\d+) lines\)$/);
    const lines = match ? parseInt(match[1], 10) : 0;

    actions.push({
      id: `test-untested-${file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: lines > 1000 ? 'high' : 'medium',
      category: 'Test Coverage',
      title: `Add tests for: ${file.replace(/ \(\d+ lines\)$/, '')}`,
      description: `Critical file with ${lines} lines has no test coverage. Add unit tests to ensure reliability.`,
      files: [file.replace(/ \(\d+ lines\)$/, '')],
      estimatedEffort: lines > 500 ? 'large' : 'medium',
      acceptanceCriteria: [
        'Unit tests cover main functionality',
        'Edge cases are tested',
        'Test coverage is at least 80% for this file',
      ],
    });
  }

  // Low coverage features
  for (const detail of testCoverage.details) {
    if (detail.coverageRatio < 0.3 && detail.untestedFiles.length > 3) {
      actions.push({
        id: `test-feature-${detail.featureName.replace(/[^a-zA-Z0-9]/g, '-')}`,
        priority: 'medium',
        category: 'Test Coverage',
        title: `Improve test coverage: ${detail.featureName}`,
        description: `Feature has only ${(detail.coverageRatio * 100).toFixed(0)}% coverage. ${detail.untestedFiles.length} files need tests.`,
        files: detail.untestedFiles.slice(0, 5),
        estimatedEffort: 'large',
        acceptanceCriteria: [
          `Coverage increased to at least 50%`,
          `Critical paths are tested`,
          `Integration tests added for main workflows`,
        ],
      });
    }
  }

  return actions;
}

/**
 * Generates action items from API consistency issues
 */
function generateAPIActions(result: AnalysisResult): ActionItem[] {
  const actions: ActionItem[] = [];
  const { apiConsistency } = result;

  // Duplicate endpoints
  for (const dup of apiConsistency.duplicateEndpoints) {
    actions.push({
      id: `api-dup-${dup.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: 'high',
      category: 'API Consistency',
      title: `Remove duplicate endpoint: ${dup.path}`,
      description: `Endpoint is defined in multiple files: ${dup.files.join(', ')}. Consolidate to single location.`,
      files: dup.files,
      estimatedEffort: 'small',
      acceptanceCriteria: [
        'Endpoint exists in only one file',
        'All consumers use the canonical endpoint',
        'Deprecated endpoint is removed',
      ],
    });
  }

  // Group other issues by type
  const verbIssues = apiConsistency.issues.filter((i) => i.type === 'verb_in_url');
  if (verbIssues.length > 0) {
    actions.push({
      id: 'api-verb-in-url',
      priority: 'low',
      category: 'API Consistency',
      title: `Fix verb-in-URL patterns: ${verbIssues.length} endpoints`,
      description:
        'REST best practice: use HTTP methods for actions, not URL verbs. E.g., POST /tasks/:id instead of POST /tasks/:id/create',
      files: [...new Set(verbIssues.map((i) => i.file))],
      estimatedEffort: 'medium',
      acceptanceCriteria: [
        'URLs use nouns, not verbs',
        'HTTP methods indicate the action',
        'API documentation is updated',
      ],
    });
  }

  return actions;
}

/**
 * Generates action items from architecture health issues
 */
function generateArchitectureActions(result: AnalysisResult): ActionItem[] {
  const actions: ActionItem[] = [];
  const { architectureHealth, imports } = result;

  // Circular dependencies
  for (const cycle of imports.circularDependencies.slice(0, 5)) {
    actions.push({
      id: `arch-circular-${cycle.cycle[0].replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: 'high',
      category: 'Architecture',
      title: `Break circular dependency`,
      description: `Circular import detected: ${cycle.cycle.join(' → ')}`,
      files: cycle.cycle,
      estimatedEffort: 'medium',
      acceptanceCriteria: [
        'Dependency cycle is broken',
        'Common functionality extracted to shared module if needed',
        'No new circular dependencies introduced',
      ],
    });
  }

  // High coupling files
  for (const file of architectureHealth.highCouplingFiles.slice(0, 5)) {
    if (file.importCount > 25) {
      actions.push({
        id: `arch-coupling-${file.file.replace(/[^a-zA-Z0-9]/g, '-')}`,
        priority: 'medium',
        category: 'Architecture',
        title: `Reduce coupling: ${file.file}`,
        description: `File imports ${file.importCount} modules and is imported by ${file.importedByCount} modules. Consider splitting or facade pattern.`,
        files: [file.file],
        estimatedEffort: 'medium',
        acceptanceCriteria: [
          'Import count reduced by at least 30%',
          'Related imports grouped into barrel exports',
          'Single responsibility principle applied',
        ],
      });
    }
  }

  // Layer violations
  for (const violation of architectureHealth.layerViolations.slice(0, 5)) {
    actions.push({
      id: `arch-layer-${violation.file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      priority: 'medium',
      category: 'Architecture',
      title: `Fix layer violation: ${violation.file}`,
      description: violation.message,
      files: [violation.file],
      estimatedEffort: 'small',
      acceptanceCriteria: [
        'Import follows proper layer boundaries',
        'If needed, shared module is created at appropriate layer',
      ],
    });
  }

  return actions;
}

/**
 * Generates action items from code quality issues
 */
function generateQualityActions(result: AnalysisResult): ActionItem[] {
  const actions: ActionItem[] = [];
  const { quality } = result;

  if (quality.anyUsage > 20) {
    actions.push({
      id: 'quality-any-usage',
      priority: 'medium',
      category: 'Code Quality',
      title: `Reduce \`any\` type usage: ${quality.anyUsage} occurrences`,
      description:
        'Replace `any` types with proper TypeScript types for better type safety and IDE support.',
      files: [],
      estimatedEffort: 'medium',
      acceptanceCriteria: [
        'any usage reduced by at least 50%',
        'Proper types defined for complex objects',
        'No new any types introduced',
      ],
    });
  }

  if (quality.emptyTryCatchCount > 5) {
    actions.push({
      id: 'quality-empty-catch',
      priority: 'medium',
      category: 'Code Quality',
      title: `Fix empty catch blocks: ${quality.emptyTryCatchCount} occurrences`,
      description: 'Empty catch blocks hide errors. Add proper error handling or logging.',
      files: [],
      estimatedEffort: 'small',
      acceptanceCriteria: [
        'All empty catch blocks have proper error handling',
        'Errors are logged appropriately',
        'User-facing errors have helpful messages',
      ],
    });
  }

  return actions;
}

/**
 * Generates split suggestion for god objects
 */
function generateSplitSuggestion(file: string, result: AnalysisResult): string {
  // Analyze the file to suggest split points
  const isComponent = file.includes('.tsx');
  const isService = file.includes('service') || file.includes('Service');
  const isRoute = file.includes('route') || file.includes('router');

  if (isComponent) {
    return `Suggested split:
1. Extract custom hooks into separate useXxx.ts files
2. Extract sub-components into separate files
3. Move types to a types.ts file
4. Extract utility functions to utils.ts`;
  }

  if (isService) {
    return `Suggested split:
1. Group related methods into domain-specific services
2. Extract validation logic to separate validator
3. Move types/interfaces to types.ts
4. Create factory for complex object creation`;
  }

  if (isRoute) {
    return `Suggested split:
1. Extract route handlers to separate handler files
2. Move validation schemas to schemas.ts
3. Create middleware for common operations
4. Group related endpoints into sub-routers`;
  }

  return `Suggested split:
1. Identify distinct responsibilities in the file
2. Create separate modules for each responsibility
3. Use barrel exports (index.ts) for clean imports
4. Ensure each module is under 300 lines`;
}

/**
 * Builds file index showing which issues affect each file
 */
function buildFileIndex(
  actions: ActionItem[],
  result: AnalysisResult,
): Record<string, { issues: string[]; dependencies: string[]; dependents: string[] }> {
  const index: Record<string, { issues: string[]; dependencies: string[]; dependents: string[] }> =
    {};

  // Build issue associations
  for (const action of actions) {
    for (const file of action.files) {
      if (!index[file]) {
        index[file] = { issues: [], dependencies: [], dependents: [] };
      }
      index[file].issues.push(action.id);
    }
  }

  // Add dependency information from imports
  for (const fanOut of result.imports.highFanOutFiles) {
    if (index[fanOut.file]) {
      index[fanOut.file].dependencies.push(`${fanOut.importCount} imports`);
    }
  }

  for (const fanIn of result.imports.highFanInFiles) {
    if (index[fanIn.file]) {
      index[fanIn.file].dependents.push(`imported by ${fanIn.importedByCount} files`);
    }
  }

  return index;
}

/**
 * Main function to generate the agent-optimized report
 */
export function generateAgentReport(result: AnalysisResult): AgentReport {
  const allActions: ActionItem[] = [
    ...generateComplexityActions(result),
    ...generateSecurityActions(result),
    ...generateTestCoverageActions(result),
    ...generateAPIActions(result),
    ...generateArchitectureActions(result),
    ...generateQualityActions(result),
  ];

  // Sort by priority
  allActions.sort((a, b) => getPriorityScore(a.priority) - getPriorityScore(b.priority));

  // Identify quick wins (small effort, high impact)
  const quickWins = allActions.filter(
    (a) => a.estimatedEffort === 'small' && (a.priority === 'high' || a.priority === 'critical'),
  );

  // Identify blockers (critical priority)
  const blockers = allActions.filter((a) => a.priority === 'critical');

  // Count by priority
  const criticalCount = allActions.filter((a) => a.priority === 'critical').length;
  const highCount = allActions.filter((a) => a.priority === 'high').length;
  const mediumCount = allActions.filter((a) => a.priority === 'medium').length;
  const lowCount = allActions.filter((a) => a.priority === 'low').length;

  // Estimate total effort
  const effortDays = allActions.reduce((sum, a) => {
    switch (a.estimatedEffort) {
      case 'small':
        return sum + 0.5;
      case 'medium':
        return sum + 2;
      case 'large':
        return sum + 5;
    }
  }, 0);

  return {
    summary: {
      totalIssues: allActions.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      estimatedTotalEffort: `${Math.ceil(effortDays)} developer-days`,
    },
    actionItems: allActions,
    fileIndex: buildFileIndex(allActions, result),
    quickWins,
    blockers,
  };
}

/**
 * Renders the agent report as Markdown
 */
export function renderAgentReportMarkdown(report: AgentReport): string {
  let md = `# Codebase Improvement Tasks for AI Agent

> This report is optimized for AI coding agents. Each task includes all necessary context.
> No additional investigation should be required to start working on these items.

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Issues | ${report.summary.totalIssues} |
| Critical | ${report.summary.criticalCount} |
| High | ${report.summary.highCount} |
| Medium | ${report.summary.mediumCount} |
| Low | ${report.summary.lowCount} |
| Estimated Effort | ${report.summary.estimatedTotalEffort} |

---

## 🚨 Blockers (Critical Priority)

${
  report.blockers.length > 0
    ? report.blockers.map((b) => renderActionItem(b)).join('\n\n')
    : '_No critical blockers identified._'
}

---

## ⚡ Quick Wins (High Impact, Low Effort)

${
  report.quickWins.length > 0
    ? report.quickWins.map((q) => renderActionItem(q)).join('\n\n')
    : '_No quick wins identified._'
}

---

## 📋 All Action Items (Prioritized)

`;

  // Group by category
  const byCategory = new Map<string, (typeof report.actionItems)[number][]>();
  for (const item of report.actionItems) {
    const existing = byCategory.get(item.category) ?? [];
    existing.push(item);
    byCategory.set(item.category, existing);
  }

  for (const [category, items] of byCategory) {
    md += `### ${category}\n\n`;
    for (const item of items) {
      md += renderActionItem(item) + '\n\n';
    }
  }

  md += `---

## 📁 File Index

Files with multiple issues should be prioritized for refactoring.

| File | Issue Count | Dependencies |
|------|-------------|--------------|
${Object.entries(report.fileIndex)
  .filter(([, data]) => data.issues.length > 0)
  .sort((a, b) => b[1].issues.length - a[1].issues.length)
  .slice(0, 30)
  .map(
    ([file, data]) =>
      `| \`${file}\` | ${data.issues.length} | ${[...data.dependencies, ...data.dependents].join(', ') || '-'} |`,
  )
  .join('\n')}

---

## 🎯 Recommended Execution Order

1. **Start with blockers** - These prevent other improvements
2. **Address quick wins** - Build momentum with easy victories
3. **Tackle high-priority items** - Focus on security and complexity
4. **Improve test coverage** - Ensure stability for future changes
5. **Clean up API consistency** - Better developer experience

---

## 📝 Notes for AI Agent

- Each action item includes specific acceptance criteria
- File paths are relative to project root
- Estimated effort: small (~0.5 day), medium (~2 days), large (~5 days)
- When splitting files, maintain backward compatibility with re-exports
- Run tests after each change to ensure nothing breaks
- Commit changes in logical units matching action items

`;

  return md;
}

/**
 * Renders a single action item
 */
function renderActionItem(item: ActionItem): string {
  const priorityEmoji = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };

  let md = `#### ${priorityEmoji[item.priority]} [${item.id}] ${item.title}

**Priority:** ${item.priority} | **Effort:** ${item.estimatedEffort} | **Category:** ${item.category}

${item.description}

**Files:**
${item.files.map((f) => `- \`${f}\``).join('\n')}

**Acceptance Criteria:**
${item.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n')}`;

  if (item.codeContext) {
    md += `

<details>
<summary>Code Context</summary>

\`\`\`typescript
${item.codeContext}
\`\`\`
</details>`;
  }

  if (item.dependencies && item.dependencies.length > 0) {
    md += `

**Dependencies:** ${item.dependencies.join(', ')}`;
  }

  return md;
}
