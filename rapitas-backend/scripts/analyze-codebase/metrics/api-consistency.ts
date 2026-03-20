/**
 * analyze-codebase/metrics/api-consistency
 *
 * Checks REST API design conventions across all discovered endpoints:
 * verb-in-URL anti-patterns, inconsistent casing, missing resource IDs,
 * and duplicate endpoint definitions across route files.
 */

import type { Endpoint, APIConsistencyIssue, AnalysisResult } from '../types';

/**
 * Analyzes REST API design consistency across all collected endpoints.
 *
 * @param endpoints - All detected API endpoints / 検出されたAPIエンドポイント一覧
 * @returns Consistency issues, REST conformance score, and duplicate list / 一貫性チェック結果
 */
export function collectAPIConsistency(endpoints: Endpoint[]): AnalysisResult['apiConsistency'] {
  const issues: APIConsistencyIssue[] = [];

  for (const ep of endpoints) {
    const pathParts = ep.path.split('/').filter(Boolean);

    // Verbs in URLs (anti-pattern for REST)
    const verbPatterns =
      /\/(execute|create|update|delete|remove|fetch|get|set|generate|validate|analyze|detect|format|seed|send|start|stop|pause|resume|complete|cancel|record|log|check|capture|download|upload|browse)\b/i;
    const verbMatch = ep.path.match(verbPatterns);
    if (verbMatch && ep.method !== 'POST') {
      issues.push({
        endpoint: `${ep.method} ${ep.path}`,
        file: ep.file,
        type: 'verb_in_url',
        message: `Verb "${verbMatch[1]}" in URL with ${ep.method} method. REST prefers nouns in URLs with HTTP verbs indicating the action.`,
      });
    }

    // Inconsistent path casing (should be kebab-case)
    for (const part of pathParts) {
      if (part.startsWith(':')) continue;
      if (/[A-Z]/.test(part) || /_/.test(part)) {
        issues.push({
          endpoint: `${ep.method} ${ep.path}`,
          file: ep.file,
          type: 'inconsistent_casing',
          message: `Path segment "${part}" uses non-kebab-case. REST convention prefers kebab-case.`,
        });
        break;
      }
    }

    // Missing resource ID in singular operations
    if ((ep.method === 'PATCH' || ep.method === 'DELETE') && !ep.path.includes(':')) {
      issues.push({
        endpoint: `${ep.method} ${ep.path}`,
        file: ep.file,
        type: 'missing_id',
        message: `${ep.method} without resource identifier in path`,
      });
    }
  }

  // Duplicate endpoints (same method + path from different files)
  const endpointMap = new Map<string, string[]>();
  for (const ep of endpoints) {
    const key = `${ep.method} ${ep.path}`;
    const files = endpointMap.get(key) || [];
    files.push(ep.file);
    endpointMap.set(key, files);
  }
  const duplicateEndpoints = [...endpointMap.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([path, files]) => ({ path, files: [...new Set(files)] }));

  // REST conformance score
  const totalEndpoints = endpoints.length;
  const issueCount = issues.length;
  const restConformanceScore =
    totalEndpoints > 0 ? Math.max(0, Math.round(100 - (issueCount / totalEndpoints) * 100)) : 100;

  return { issues, restConformanceScore, duplicateEndpoints };
}
