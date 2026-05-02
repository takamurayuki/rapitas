/**
 * analyze-codebase/metrics/architecture-metrics
 *
 * Extracts structural information about the backend (routes, endpoints, services),
 * Prisma schema models, and frontend components/hooks/pages.
 * Does not perform quality scoring — that belongs in scoring.ts.
 */

import { basename } from 'path';
import { THRESHOLDS } from '../constants';
import type { FileInfo, Endpoint, PrismaModel, AnalysisResult } from '../types';

/**
 * Collects architectural metrics for backend routes, Prisma models, and frontend structure.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Architecture breakdown for backend, prisma, and frontend layers / アーキテクチャ集計
 */
export function collectArchitectureMetrics(files: FileInfo[]): AnalysisResult['architecture'] {
  // Backend routes & endpoints (excluding test files)
  const routeFiles = files.filter(
    (f) =>
      f.relativePath.startsWith('rapitas-backend') &&
      f.relativePath.includes('routes') &&
      f.ext === '.ts' &&
      !f.relativePath.match(/\.(test|spec)\.ts$/),
  );

  const endpoints: Endpoint[] = [];
  for (const rf of routeFiles) {
    const prefixMatch = rf.content.match(/\.group\s*\(\s*["'`]([^"'`]+)["'`]/);
    const prefix2 = rf.content.match(/prefix\s*[:=]\s*["'`]([^"'`]+)["'`]/);
    const routePrefix = prefixMatch?.[1] || prefix2?.[1] || '';

    const methodRegex = /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    let match;
    while ((match = methodRegex.exec(rf.content)) !== null) {
      const path = match[2];
      // Skip false positives: header access like headers.get('x-forwarded-for')
      const contextStart = Math.max(0, match.index - 30);
      const context = rf.content.slice(contextStart, match.index);
      if (/headers\s*$/.test(context) || /request\s*$/.test(context)) continue;
      // Skip non-route paths (no leading slash and not a route pattern)
      if (!path.startsWith('/') && !path.startsWith(':')) continue;
      endpoints.push({
        method: match[1].toUpperCase(),
        path: routePrefix ? `${routePrefix}${path}` : path,
        file: rf.relativePath,
      });
    }
  }

  // Backend services
  const serviceFiles = files.filter(
    (f) =>
      f.relativePath.startsWith('rapitas-backend') &&
      f.relativePath.includes('services') &&
      f.ext === '.ts',
  );
  const services = serviceFiles.map((f) => f.relativePath);

  // Prisma models
  const prismaFile = files.find((f) => f.relativePath.endsWith('schema.prisma'));
  const models: PrismaModel[] = [];
  if (prismaFile) {
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
    let mMatch;
    while ((mMatch = modelRegex.exec(prismaFile.content)) !== null) {
      const modelName = mMatch[1];
      const body = mMatch[2];
      const fieldLines = body
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('@@'));
      const relationTargets: string[] = [];
      const relRegex = /@relation\s*\(\s*(?:name:\s*["']([^"']+)["'],?\s*)?fields:\s*\[([^\]]+)\]/g;
      let rMatch;
      while ((rMatch = relRegex.exec(body)) !== null) {
        relationTargets.push(rMatch[1] || rMatch[2]);
      }
      models.push({
        name: modelName,
        fieldCount: fieldLines.length,
        relations: relationTargets,
      });
    }
  }

  const oversizedModels = models
    .filter((m) => m.fieldCount > THRESHOLDS.maxFieldsPerModel)
    .map((m) => ({ name: m.name, fieldCount: m.fieldCount }))
    .sort((a, b) => b.fieldCount - a.fieldCount);

  // Frontend components
  const componentCategories = new Map<string, string[]>();
  const frontendComponents = files.filter(
    (f) => f.relativePath.startsWith('rapitas-frontend') && f.ext === '.tsx',
  );
  for (const f of frontendComponents) {
    const parts = f.relativePath.split(/[\\/]/);
    let category = 'other';
    if (parts.includes('feature')) {
      const idx = parts.indexOf('feature');
      category = parts[idx + 1] || 'feature';
    } else if (parts.includes('components')) {
      category = 'shared-components';
    } else if (parts.includes('app')) {
      category = 'pages';
    }
    const list = componentCategories.get(category) || [];
    list.push(f.relativePath);
    componentCategories.set(category, list);
  }

  const components = [...componentCategories.entries()]
    .map(([cat, fileList]) => ({
      category: cat,
      count: fileList.length,
      files: fileList,
    }))
    .sort((a, b) => b.count - a.count);

  const hooks = files
    .filter(
      (f) => f.relativePath.startsWith('rapitas-frontend') && f.relativePath.includes('hooks'),
    )
    .map((f) => basename(f.relativePath, f.ext));

  const stores = files
    .filter(
      (f) => f.relativePath.startsWith('rapitas-frontend') && f.relativePath.includes('stores'),
    )
    .map((f) => basename(f.relativePath, f.ext));

  const pages = files
    .filter(
      (f) =>
        f.relativePath.startsWith('rapitas-frontend') &&
        f.relativePath.includes('app') &&
        basename(f.relativePath) === 'page.tsx',
    )
    .map((f) => {
      const parts = f.relativePath.split(/[\\/]/);
      const appIdx = parts.indexOf('app');
      return '/' + parts.slice(appIdx + 1, -1).join('/');
    });

  return {
    backend: { routeFiles: routeFiles.length, endpoints, services },
    prisma: {
      modelCount: models.length,
      models,
      totalRelations: models.reduce((sum, m) => sum + m.relations.length, 0),
      oversizedModels,
    },
    frontend: { components, hooks, stores, pages },
  };
}
