/**
 * analyze-codebase/constants
 *
 * Project root paths, excluded directory lists, supported file extensions,
 * and complexity threshold values shared across all analysis modules.
 */

import { join } from 'path';

export const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..');
export const BACKEND_ROOT = join(PROJECT_ROOT, 'rapitas-backend');
export const FRONTEND_ROOT = join(PROJECT_ROOT, 'rapitas-frontend');
export const DESKTOP_ROOT = join(PROJECT_ROOT, 'rapitas-desktop');

export const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  '.next-tauri',
  'dist',
  '.git',
  'target',
  'build',
  'uploads',
  'logs',
  '.claude',
  '.storybook',
  'out',
  '.turbo',
  'coverage',
  '.prisma',
  '.dart_tool',
  'flutter',
  'rapitas-manager',
  'gen',
  'src-tauri',
  '.turbopack',
]);

export const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.prisma',
  '.json',
  '.md',
  '.html',
  '.yaml',
  '.yml',
  '.toml',
  '.rs',
  '.sql',
]);

/** Complexity thresholds used for warnings throughout analysis. */
export const THRESHOLDS = {
  godObjectLines: 500,
  oversizedFileLines: 1000,
  criticalFileLines: 2000,
  maxFunctionLines: 100,
  maxNestingDepth: 5,
  maxFieldsPerModel: 30,
  maxEndpointsPerRoute: 15,
  maxImportsPerFile: 20,
};
