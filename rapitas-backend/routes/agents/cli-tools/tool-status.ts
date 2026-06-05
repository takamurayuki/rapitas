/**
 * CLI Tool Status Helpers
 *
 * Functions for checking installation status, authentication state,
 * fetching release info from GitHub, and generating installation guides.
 * These are pure utility functions with no HTTP layer dependency.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../config/logger';
import { type CLITool, type GitHubRelease } from './types';

const execAsync = promisify(exec);
const log = createLogger('routes:cli-tools:status');

let refreshedPathCache: { value: string; at: number } | null = null;
const PATH_REFRESH_TTL_MS = 30_000;

/**
 * Re-read the LIVE PATH (Machine + User) from the Windows registry. The backend
 * captures PATH at launch, so a CLI installed AFTER startup (e.g. via the
 * terminal) lives in a dir the process's stale PATH lacks — making `where <cmd>`
 * wrongly report "not installed". PowerShell inherits our stale PATH too, so we
 * read the values straight from the environment store. Cached briefly; returns
 * undefined off Windows or on failure (callers then use the process env).
 *
 * @returns Live PATH string, or undefined / 最新PATH文字列、取得不可ならundefined
 */
async function getRefreshedPath(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  if (refreshedPathCache && Date.now() - refreshedPathCache.at < PATH_REFRESH_TTL_MS) {
    return refreshedPathCache.value;
  }
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`,
      { timeout: 5000 },
    );
    const value = stdout.trim();
    if (value) {
      refreshedPathCache = { value, at: Date.now() };
      return value;
    }
  } catch {
    // fall through — caller uses the process env PATH
  }
  return undefined;
}

/**
 * Get the installation and authentication status for a CLI tool.
 *
 * @param tool - The CLI tool definition to check / CLIツール定義
 * @returns Installation and auth state / インストール・認証状態
 */
export async function getToolStatus(tool: CLITool): Promise<{
  isInstalled: boolean;
  version: string | null;
  isAuthenticated: boolean;
  installPath?: string;
  error?: string;
}> {
  try {
    let isInstalled = false;
    let version: string | null = null;
    let installPath: string | undefined;

    // Run checks with the LIVE PATH so a CLI installed after backend start is
    // still detected (no restart needed just to show correct status).
    const refreshedPath = await getRefreshedPath();
    const execEnv = refreshedPath
      ? { ...process.env, Path: refreshedPath, PATH: refreshedPath }
      : process.env;

    try {
      const checkResult = await execAsync(tool.checkCommand, { timeout: 5000, env: execEnv });
      if (checkResult.stdout.trim()) {
        isInstalled = true;
        installPath = checkResult.stdout.trim().split('\n')[0];
      }
    } catch {
      isInstalled = false;
    }

    if (isInstalled) {
      try {
        const versionResult = await execAsync(tool.versionCommand, {
          timeout: 30000,
          env: execEnv,
        });
        version = versionResult.stdout.trim() || versionResult.stderr.trim();
      } catch (error) {
        log.warn({ err: error }, `Failed to get version for ${tool.id}`);
      }
    }

    let isAuthenticated = false;
    if (isInstalled && tool.authCheck) {
      try {
        const authResult = await execAsync(tool.authCheck, { timeout: 5000, env: execEnv });
        isAuthenticated = checkAuthenticationStatus(tool, authResult);
      } catch {
        isAuthenticated = false;
      }
    }

    return { isInstalled, version, isAuthenticated, installPath };
  } catch (error) {
    return {
      isInstalled: false,
      version: null,
      isAuthenticated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetch the latest release information from GitHub for a tool's documentation URL.
 *
 * @param repoUrl - GitHub repository URL / GitHubリポジトリURL
 * @returns Release info or null on failure / リリース情報またはnull
 */
export async function getLatestReleaseInfo(repoUrl: string): Promise<{
  version: string;
  releaseDate: string;
  changelog: string;
  downloadUrl: string;
} | null> {
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;

    const [, owner, repo] = match;
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);

    if (!response.ok) return null;

    const data = (await response.json()) as GitHubRelease;

    return {
      version: data.tag_name || data.name,
      releaseDate: data.published_at,
      changelog: data.body || '',
      downloadUrl: data.html_url,
    };
  } catch (error) {
    log.warn({ err: error }, 'Failed to fetch release info');
    return null;
  }
}

/**
 * Determine authentication status from CLI command output.
 * Each tool has a different output format, so matching is tool-specific.
 *
 * @param tool - The CLI tool definition / CLIツール定義
 * @param authResult - stdout and stderr from the auth-check command / 認証確認コマンド出力
 * @returns true if authenticated / 認証済みならtrue
 */
export function checkAuthenticationStatus(
  tool: CLITool,
  authResult: { stdout: string; stderr: string },
): boolean {
  const output = authResult.stdout + authResult.stderr;

  switch (tool.id) {
    case 'claude-cli':
      // Claude CLI: returns {"loggedIn": true/false} in JSON format
      try {
        const jsonOutput = JSON.parse(authResult.stdout);
        return jsonOutput.loggedIn === true;
      } catch {
        // Fall back to string matching when JSON parse fails
        const lowerOutput = output.toLowerCase();
        return (
          lowerOutput.includes('authenticated') ||
          lowerOutput.includes('logged in') ||
          lowerOutput.includes('valid')
        );
      }

    case 'openai-cli': {
      // OpenAI CLI: shows API key or user info when authenticated
      const lowerOutputOpenai = output.toLowerCase();
      return (
        !lowerOutputOpenai.includes('not authenticated') &&
        !lowerOutputOpenai.includes('no api key') &&
        !lowerOutputOpenai.includes('authentication required') &&
        (lowerOutputOpenai.includes('api') ||
          lowerOutputOpenai.includes('authenticated') ||
          output.length > 10)
      );
    }

    case 'gemini-cli':
      // NOTE: Gemini CLI lacks a standard auth-status command; treat installed as authenticated.
      // Actual authentication is required on a per-command basis.
      return true;

    case 'gh-cli': {
      // GitHub CLI: shows "logged in" or account name when authenticated
      const lowerOutputGh = output.toLowerCase();
      return (
        lowerOutputGh.includes('logged in') ||
        output.includes('✓') ||
        lowerOutputGh.includes('github.com') ||
        (!lowerOutputGh.includes('not logged in') && !lowerOutputGh.includes('to authenticate'))
      );
    }

    default: {
      // Default: assume authenticated if there is output and no error keywords
      const lowerOutputDefault = output.toLowerCase();
      return (
        !lowerOutputDefault.includes('error') &&
        !lowerOutputDefault.includes('not authenticated') &&
        !lowerOutputDefault.includes('authentication') &&
        output.trim().length > 0
      );
    }
  }
}

/**
 * Generate step-by-step installation guide for a CLI tool.
 *
 * @param tool - The CLI tool to generate a guide for / ガイドを生成するCLIツール
 * @returns Array of installation steps / インストール手順の配列
 */
export function generateInstallationGuide(tool: CLITool): Array<{
  step: number;
  title: string;
  description: string;
  command?: string;
  notes?: string;
}> {
  const steps: Array<{
    step: number;
    title: string;
    description: string;
    command?: string;
    notes?: string;
  }> = [];

  steps.push({
    step: 1,
    title: `Install ${tool.name}`,
    description: `Install ${tool.name} using the package manager`,
    command: tool.installCommand,
    notes: tool.category === 'ai' ? 'This will install the CLI globally on your system' : undefined,
  });

  if (tool.authCommand) {
    steps.push({
      step: 2,
      title: 'Authentication',
      description: `Authenticate ${tool.name} with your account`,
      command: tool.authCommand,
      notes: 'Follow the interactive prompts to complete authentication',
    });
  }

  steps.push({
    step: 3,
    title: 'Verify Installation',
    description: 'Verify that the tool is installed and working correctly',
    command: tool.versionCommand,
    notes: 'This should display the installed version',
  });

  return steps;
}
