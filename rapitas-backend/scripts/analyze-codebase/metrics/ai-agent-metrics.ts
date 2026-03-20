/**
 * analyze-codebase/metrics/ai-agent-metrics
 *
 * Detects AI provider integrations (Anthropic, OpenAI, Google) and collects
 * agent-related route and service files. Also reads package.json files to
 * report production and dev dependency counts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { BACKEND_ROOT, FRONTEND_ROOT } from '../constants';
import type { FileInfo, AnalysisResult } from '../types';

/**
 * Scans backend files for AI provider usage and agent-related modules.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Detected AI providers, agent types, routes, and services / AI関連メトリクス
 */
export function collectAIAgentMetrics(files: FileInfo[]): AnalysisResult['aiAgent'] {
  const providers: Set<string> = new Set();
  const agentTypes: Set<string> = new Set();

  for (const f of files) {
    if (!f.relativePath.startsWith('rapitas-backend')) continue;
    if (f.ext !== '.ts') continue;

    if (f.content.includes('@anthropic-ai/sdk') || f.content.includes('Anthropic'))
      providers.add('Anthropic (Claude)');
    if (f.content.includes('openai') || f.content.includes('OpenAI')) providers.add('OpenAI');
    if (f.content.includes('@google/generative-ai') || f.content.includes('GoogleGenerativeAI'))
      providers.add('Google (Gemini)');

    if (f.relativePath.includes('agent')) {
      const typeMatches = f.content.matchAll(/agentType['":\s]*["'`](\w+)["'`]/g);
      for (const m of typeMatches) {
        agentTypes.add(m[1]);
      }
      const enumMatches = f.content.matchAll(
        /["'`](code_review|implementation|bug_fix|refactor|test_generation|analysis|planning|execution|auto_run|manual)["'`]/g,
      );
      for (const m of enumMatches) {
        agentTypes.add(m[1]);
      }
    }
  }

  const agentRoutes = files
    .filter(
      (f) =>
        f.relativePath.startsWith('rapitas-backend') &&
        f.relativePath.includes('route') &&
        f.relativePath.includes('agent'),
    )
    .map((f) => f.relativePath);

  const agentServices = files
    .filter(
      (f) =>
        f.relativePath.startsWith('rapitas-backend') &&
        f.relativePath.includes('service') &&
        f.relativePath.includes('agent'),
    )
    .map((f) => f.relativePath);

  return {
    providers: [...providers],
    agentTypes: [...agentTypes],
    agentRoutes,
    agentServices,
  };
}

/**
 * Reads package.json files to count production and dev dependencies.
 *
 * @returns Dependency counts for backend and frontend / 依存パッケージ数
 */
export function collectDependencyMetrics(): AnalysisResult['dependencies'] {
  const readPkg = (dir: string) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      const prod = Object.keys(pkg.dependencies || {}).length;
      const dev = Object.keys(pkg.devDependencies || {}).length;
      return { total: prod + dev, production: prod, dev };
    } catch {
      return { total: 0, production: 0, dev: 0 };
    }
  };

  return {
    backend: readPkg(BACKEND_ROOT),
    frontend: readPkg(FRONTEND_ROOT),
  };
}
