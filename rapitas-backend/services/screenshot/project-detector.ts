/**
 * Screenshot Service — ProjectDetector
 *
 * Auto-detects frontend project structure (Next.js, Vite, CRA, Nuxt, Angular)
 * and dev server port from config files in a given working directory.
 * Not responsible for page scanning or screenshot capture.
 */

import { join, basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { ProjectInfo } from './types';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Auto-detect project structure from the working directory.
 *
 * @param workingDirectory - Root directory to inspect / 検査するルートディレクトリ
 * @returns Detected project info including type, port, and directory paths
 */
export function detectProjectInfo(workingDirectory: string): ProjectInfo {
  const result: ProjectInfo = {
    type: 'unknown',
    frontendDir: null,
    devPort: 3000,
    baseUrl: 'http://localhost:3000',
    srcDir: null,
    appDir: null,
    pagesDir: null,
  };

  // Search for frontend directory candidates
  const frontendDirCandidates = [
    '', // When frontend is in root directory
    'frontend',
    'client',
    'web',
    'app',
  ];

  // Add project-specific frontend directory (e.g., rapitas-frontend)
  const projectName = basename(workingDirectory);
  frontendDirCandidates.push(`${projectName}-frontend`);

  // Search child directories for frontend candidates
  try {
    const entries = require('fs').readdirSync(workingDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('-frontend')) {
        if (!frontendDirCandidates.includes(entry.name)) {
          frontendDirCandidates.push(entry.name);
        }
      }
    }
  } catch {
    // ignore
  }

  for (const candidate of frontendDirCandidates) {
    const dir = candidate ? join(workingDirectory, candidate) : workingDirectory;
    const packageJsonPath = join(dir, 'package.json');

    if (!existsSync(packageJsonPath)) continue;

    let packageJson: PackageJson;
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      continue;
    }

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Next.js
    if (deps?.next) {
      result.type = 'nextjs';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'nextjs') || 3000;

      // src/app (App Router) or src/pages (Pages Router) or app/ or pages/
      if (existsSync(join(dir, 'src', 'app'))) {
        result.srcDir = join(dir, 'src');
        result.appDir = join(dir, 'src', 'app');
      } else if (existsSync(join(dir, 'app'))) {
        result.appDir = join(dir, 'app');
      }
      if (existsSync(join(dir, 'src', 'pages'))) {
        result.srcDir = result.srcDir || join(dir, 'src');
        result.pagesDir = join(dir, 'src', 'pages');
      } else if (existsSync(join(dir, 'pages'))) {
        result.pagesDir = join(dir, 'pages');
      }
      break;
    }

    // Vite (React, Vue, Svelte)
    if (deps?.vite) {
      result.type = 'vite';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'vite') || 5173;
      if (existsSync(join(dir, 'src'))) {
        result.srcDir = join(dir, 'src');
      }
      break;
    }

    // Create React App
    if (deps?.['react-scripts']) {
      result.type = 'cra';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'cra') || 3000;
      if (existsSync(join(dir, 'src'))) {
        result.srcDir = join(dir, 'src');
      }
      break;
    }

    // Nuxt
    if (deps?.nuxt) {
      result.type = 'nuxt';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'nuxt') || 3000;
      if (existsSync(join(dir, 'pages'))) {
        result.pagesDir = join(dir, 'pages');
      }
      break;
    }

    // Angular
    if (deps?.['@angular/core']) {
      result.type = 'angular';
      result.frontendDir = dir;
      result.devPort = detectPort(dir, 'angular') || 4200;
      if (existsSync(join(dir, 'src'))) {
        result.srcDir = join(dir, 'src');
      }
      break;
    }
  }

  result.baseUrl = `http://localhost:${result.devPort}`;
  return result;
}

/**
 * Detect dev server port from config files in the given directory.
 *
 * @param dir - Project directory to inspect / 検査するプロジェクトディレクトリ
 * @param projectType - Framework type for targeted config parsing / フレームワーク種別
 * @returns Detected port number, or null if not found
 */
function detectPort(dir: string, projectType: string): number | null {
  try {
    // Check package.json scripts section
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
      const devScript = pkg.scripts?.dev || pkg.scripts?.start || '';
      const portMatch = devScript.match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
      if (portMatch) {
        return parseInt(portMatch[1] || portMatch[2] || portMatch[3]);
      }
    }

    // Next.js: check .env for PORT=
    if (projectType === 'nextjs') {
      const envPath = join(dir, '.env');
      if (existsSync(envPath)) {
        const env = readFileSync(envPath, 'utf-8');
        const match = env.match(/PORT=(\d+)/);
        if (match) return parseInt(match[1]);
      }
    }

    // Vite: vite.config.ts / vite.config.js
    if (projectType === 'vite') {
      for (const configFile of ['vite.config.ts', 'vite.config.js']) {
        const configPath = join(dir, configFile);
        if (existsSync(configPath)) {
          const content = readFileSync(configPath, 'utf-8');
          const match = content.match(/port\s*:\s*(\d+)/);
          if (match) return parseInt(match[1]);
        }
      }
    }

    // Angular: angular.json
    if (projectType === 'angular') {
      const angularJsonPath = join(dir, 'angular.json');
      if (existsSync(angularJsonPath)) {
        const angularJson = JSON.parse(readFileSync(angularJsonPath, 'utf-8'));
        const projects = angularJson.projects || {};
        for (const projName of Object.keys(projects)) {
          const port = projects[projName]?.architect?.serve?.options?.port;
          if (port) return port;
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return null;
}
