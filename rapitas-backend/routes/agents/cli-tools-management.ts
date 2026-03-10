/**
 * CLI Tools Management API Routes
 * Version control, installation, and update management for CLI tools (Claude, OpenAI, Gemini)
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { exec } from 'child_process';

const log = createLogger('routes:cli-tools');
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// CLI ツール定義
interface CLITool {
  id: string;
  name: string;
  description: string;
  packageName?: string;
  checkCommand: string;
  versionCommand: string;
  installCommand: string;
  updateCommand?: string;
  configCommand?: string;
  authCommand?: string;
  authCheck?: string;
  category: 'ai' | 'development' | 'utility';
  officialSite: string;
  documentation: string;
}

const CLI_TOOLS: CLITool[] = [
  {
    id: 'claude-cli',
    name: 'Claude CLI',
    description: 'Official Claude CLI tool by Anthropic',
    checkCommand: 'where claude',
    versionCommand: 'claude --version',
    installCommand: 'npm install -g @anthropic-ai/claude-cli',
    updateCommand: 'npm update -g @anthropic-ai/claude-cli',
    authCommand: 'claude auth login',
    authCheck: 'claude auth status',
    category: 'ai',
    officialSite: 'https://claude.ai',
    documentation: 'https://docs.anthropic.com/claude/cli',
  },
  {
    id: 'openai-cli',
    name: 'OpenAI CLI',
    description: 'OpenAI command line interface',
    packageName: 'openai',
    checkCommand: 'pip show openai',
    versionCommand: 'pip show openai | findstr Version',
    installCommand: 'pip install openai',
    updateCommand: 'pip install --upgrade openai',
    authCommand: 'openai auth',
    category: 'ai',
    officialSite: 'https://openai.com',
    documentation: 'https://platform.openai.com/docs',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'Google Gemini command line interface',
    checkCommand: 'where gemini',
    versionCommand: 'gemini -v',
    installCommand: 'npm install -g @google/gemini-cli',
    updateCommand: 'npm update -g @google/gemini-cli',
    authCommand: 'gemini auth login',
    authCheck: 'gemini auth status',
    category: 'ai',
    officialSite: 'https://ai.google.dev',
    documentation: 'https://ai.google.dev/docs',
  },
  {
    id: 'gh-cli',
    name: 'GitHub CLI',
    description: 'GitHub command line interface',
    checkCommand: 'where gh',
    versionCommand: 'gh --version',
    installCommand: 'winget install GitHub.cli',
    updateCommand: 'gh extension upgrade --all',
    authCommand: 'gh auth login',
    authCheck: 'gh auth status',
    category: 'development',
    officialSite: 'https://cli.github.com',
    documentation: 'https://cli.github.com/manual/',
  },
];

// ツールの状態を取得
async function getToolStatus(tool: CLITool): Promise<{
  isInstalled: boolean;
  version: string | null;
  isAuthenticated: boolean;
  installPath?: string;
  error?: string;
}> {
  try {
    // インストール状況確認
    let isInstalled = false;
    let version: string | null = null;
    let installPath: string | undefined;

    try {
      const checkResult = await execAsync(tool.checkCommand, { timeout: 5000 });
      if (checkResult.stdout.trim()) {
        isInstalled = true;
        installPath = checkResult.stdout.trim().split('\n')[0];
      }
    } catch (error) {
      isInstalled = false;
    }

    // バージョン取得
    if (isInstalled) {
      try {
        const versionResult = await execAsync(tool.versionCommand, {
          timeout: 30000,
        });
        version = versionResult.stdout.trim() || versionResult.stderr.trim();
      } catch (error) {
        log.warn({ err: error }, `Failed to get version for ${tool.id}`);
      }
    }

    // 認証状況確認
    let isAuthenticated = false;
    if (isInstalled && tool.authCheck) {
      try {
        const authResult = await execAsync(tool.authCheck, { timeout: 5000 });
        isAuthenticated = checkAuthenticationStatus(tool, authResult);
      } catch (error) {
        isAuthenticated = false;
      }
    }

    return {
      isInstalled,
      version,
      isAuthenticated,
      installPath,
    };
  } catch (error) {
    return {
      isInstalled: false,
      version: null,
      isAuthenticated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// GitHub Release APIのレスポンス型
interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  html_url: string;
}

// リリース情報を取得（GitHub APIから）
async function getLatestReleaseInfo(repoUrl: string): Promise<{
  version: string;
  releaseDate: string;
  changelog: string;
  downloadUrl: string;
} | null> {
  try {
    // GitHub API経由で最新リリース情報を取得
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
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

// 認証状態を判定
function checkAuthenticationStatus(
  tool: CLITool,
  authResult: { stdout: string; stderr: string },
): boolean {
  const output = authResult.stdout + authResult.stderr;

  switch (tool.id) {
    case 'claude-cli':
      // Claude CLI: JSON形式で {"loggedIn": true/false} を返す
      try {
        const jsonOutput = JSON.parse(authResult.stdout);
        return jsonOutput.loggedIn === true;
      } catch {
        // JSON パースに失敗した場合は従来のロジックでフォールバック
        const lowerOutput = output.toLowerCase();
        return (
          lowerOutput.includes('authenticated') ||
          lowerOutput.includes('logged in') ||
          lowerOutput.includes('valid')
        );
      }

    case 'openai-cli':
      // OpenAI CLI: 認証済みの場合はAPIキー情報やユーザー情報が表示される
      const lowerOutputOpenai = output.toLowerCase();
      return (
        !lowerOutputOpenai.includes('not authenticated') &&
        !lowerOutputOpenai.includes('no api key') &&
        !lowerOutputOpenai.includes('authentication required') &&
        (lowerOutputOpenai.includes('api') ||
          lowerOutputOpenai.includes('authenticated') ||
          output.length > 10)
      );

    case 'gemini-cli':
      // Gemini CLI: 標準的な認証ステータスコマンドが提供されていないため、インストール済みであれば認証済みと見なす
      // 実際の認証は各コマンド実行時に個別に必要になる
      return true;

    case 'gh-cli':
      // GitHub CLI: 認証済みの場合は "logged in" やアカウント名が表示される
      const lowerOutputGh = output.toLowerCase();
      return (
        lowerOutputGh.includes('logged in') ||
        output.includes('✓') ||
        lowerOutputGh.includes('github.com') ||
        (!lowerOutputGh.includes('not logged in') && !lowerOutputGh.includes('to authenticate'))
      );

    default:
      // デフォルト: エラーメッセージがなく、何らかの出力があれば認証済みと判定
      const lowerOutputDefault = output.toLowerCase();
      return (
        !lowerOutputDefault.includes('error') &&
        !lowerOutputDefault.includes('not authenticated') &&
        !lowerOutputDefault.includes('authentication') &&
        output.trim().length > 0
      );
  }
}

export const cliToolsManagementRoutes = new Elysia()
  // Get all CLI tools with their status
  .get('/cli-tools', async () => {
    try {
      const tools = await Promise.all(
        CLI_TOOLS.map(async (tool) => {
          const status = await getToolStatus(tool);
          return {
            ...tool,
            ...status,
            status: status.isInstalled
              ? status.isAuthenticated
                ? 'authenticated'
                : 'installed'
              : 'not_installed',
          };
        }),
      );

      return {
        success: true,
        data: {
          tools,
          summary: {
            total: tools.length,
            installed: tools.filter((t) => t.isInstalled).length,
            authenticated: tools.filter((t) => t.isAuthenticated).length,
            needsUpdate: 0,
          },
        },
      };
    } catch (error) {
      log.error({ err: error }, '[CLI Tools] Error fetching tools status');
      return {
        success: false,
        error: 'Failed to fetch CLI tools status',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Get specific tool details
  .get('/cli-tools/:toolId', async ({ params }) => {
    try {
      const { toolId } = params;
      const tool = CLI_TOOLS.find((t) => t.id === toolId);

      if (!tool) {
        return {
          success: false,
          error: 'Tool not found',
        };
      }

      const status = await getToolStatus(tool);

      // リリース情報取得（GitHub APIから）
      const releaseInfo = await getLatestReleaseInfo(tool.documentation);

      return {
        success: true,
        data: {
          ...tool,
          ...status,
          releaseInfo,
          status: status.isInstalled
            ? status.isAuthenticated
              ? 'authenticated'
              : 'installed'
            : 'not_installed',
        },
      };
    } catch (error) {
      log.error({ err: error }, '[CLI Tools] Error fetching tool details');
      return {
        success: false,
        error: 'Failed to fetch tool details',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Install CLI tool
  .post('/cli-tools/:toolId/install', async ({ params }) => {
    try {
      const { toolId } = params;
      const tool = CLI_TOOLS.find((t) => t.id === toolId);

      if (!tool) {
        return {
          success: false,
          error: 'Tool not found',
        };
      }

      // 既にインストール済みかチェック
      const currentStatus = await getToolStatus(tool);
      if (currentStatus.isInstalled) {
        return {
          success: false,
          error: 'Tool is already installed',
        };
      }

      // インストール実行
      log.info(`[CLI Tools] Installing ${tool.name}...`);
      const installResult = await execAsync(tool.installCommand, {
        timeout: 300000,
      }); // 5 minutes timeout

      // インストール後の状態確認
      const newStatus = await getToolStatus(tool);

      return {
        success: newStatus.isInstalled,
        data: {
          tool: {
            ...tool,
            ...newStatus,
          },
          installOutput: installResult.stdout,
          message: newStatus.isInstalled
            ? `Successfully installed ${tool.name}`
            : 'Installation may have failed, please check manually',
        },
      };
    } catch (error) {
      log.error({ err: error }, '[CLI Tools] Error installing tool');
      return {
        success: false,
        error: 'Failed to install tool',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Update CLI tool
  .post('/cli-tools/:toolId/update', async ({ params }) => {
    try {
      const { toolId } = params;
      const tool = CLI_TOOLS.find((t) => t.id === toolId);

      if (!tool || !tool.updateCommand) {
        return {
          success: false,
          error: 'Tool not found or update not supported',
        };
      }

      // インストール状況確認
      const currentStatus = await getToolStatus(tool);
      if (!currentStatus.isInstalled) {
        return {
          success: false,
          error: 'Tool is not installed',
        };
      }

      const previousVersion = currentStatus.version;

      // 更新実行
      log.info(`[CLI Tools] Updating ${tool.name}...`);
      const updateResult = await execAsync(tool.updateCommand, {
        timeout: 300000,
      });

      // 更新後の状態確認
      const newStatus = await getToolStatus(tool);

      return {
        success: true,
        data: {
          tool: {
            ...tool,
            ...newStatus,
          },
          updateOutput: updateResult.stdout,
          previousVersion,
          newVersion: newStatus.version,
          message:
            `Successfully updated ${tool.name}` +
            (previousVersion && newStatus.version && previousVersion !== newStatus.version
              ? ` from ${previousVersion} to ${newStatus.version}`
              : ''),
        },
      };
    } catch (error) {
      log.error({ err: error }, '[CLI Tools] Error updating tool');
      return {
        success: false,
        error: 'Failed to update tool',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Authenticate CLI tool
  .post('/cli-tools/:toolId/auth', async ({ params, body }) => {
    try {
      const { toolId } = params;
      const { interactive = false } = body as { interactive?: boolean };
      const tool = CLI_TOOLS.find((t) => t.id === toolId);

      if (!tool || !tool.authCommand) {
        return {
          success: false,
          error: 'Tool not found or authentication not supported',
        };
      }

      // インストール状況確認
      const currentStatus = await getToolStatus(tool);
      if (!currentStatus.isInstalled) {
        return {
          success: false,
          error: 'Tool is not installed',
        };
      }

      if (interactive) {
        // インタラクティブ認証の場合は、ユーザーに指示を返す
        return {
          success: true,
          data: {
            interactive: true,
            command: tool.authCommand,
            message: `Please run the following command in your terminal to authenticate ${tool.name}: ${tool.authCommand}`,
          },
        };
      } else {
        // 非インタラクティブな認証状況確認
        const newStatus = await getToolStatus(tool);

        return {
          success: true,
          data: {
            tool: {
              ...tool,
              ...newStatus,
            },
            isAuthenticated: newStatus.isAuthenticated,
            message: newStatus.isAuthenticated
              ? `${tool.name} is authenticated`
              : `${tool.name} requires authentication. Run: ${tool.authCommand}`,
          },
        };
      }
    } catch (error) {
      log.error({ err: error }, '[CLI Tools] Error checking authentication');
      return {
        success: false,
        error: 'Failed to check authentication',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Get installation guide for tool
  .get('/cli-tools/:toolId/install-guide', async ({ params }) => {
    try {
      const { toolId } = params;
      const tool = CLI_TOOLS.find((t) => t.id === toolId);

      if (!tool) {
        return {
          success: false,
          error: 'Tool not found',
        };
      }

      const installationSteps = generateInstallationGuide(tool);

      return {
        success: true,
        data: {
          tool: tool,
          steps: installationSteps,
        },
      };
    } catch (error) {
      log.error({ err: error }, '[CLI Tools] Error fetching installation guide');
      return {
        success: false,
        error: 'Failed to fetch installation guide',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });

function generateInstallationGuide(tool: CLITool): Array<{
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

  // インストール手順
  steps.push({
    step: 1,
    title: `Install ${tool.name}`,
    description: `Install ${tool.name} using the package manager`,
    command: tool.installCommand,
    notes: tool.category === 'ai' ? 'This will install the CLI globally on your system' : undefined,
  });

  // 認証手順
  if (tool.authCommand) {
    steps.push({
      step: 2,
      title: 'Authentication',
      description: `Authenticate ${tool.name} with your account`,
      command: tool.authCommand,
      notes: 'Follow the interactive prompts to complete authentication',
    });
  }

  // 確認手順
  steps.push({
    step: 3,
    title: 'Verify Installation',
    description: 'Verify that the tool is installed and working correctly',
    command: tool.versionCommand,
    notes: 'This should display the installed version',
  });

  return steps;
}
