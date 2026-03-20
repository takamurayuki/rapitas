/**
 * CLI Tools Management Routes
 *
 * HTTP route handlers for CLI tool lifecycle: list, detail, install, update,
 * authenticate, and installation guides. Delegates status checks to tool-status.ts.
 */
import { Elysia } from 'elysia';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../config/logger';
import { CLI_TOOLS } from './types';
import { getToolStatus, getLatestReleaseInfo, generateInstallationGuide } from './tool-status';

const execAsync = promisify(exec);
const log = createLogger('routes:cli-tools:routes');

/**
 * Elysia route group for CLI tools management.
 * All routes are relative to the parent Elysia instance's prefix.
 */
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
        return { success: false, error: 'Tool not found' };
      }

      const status = await getToolStatus(tool);
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
        return { success: false, error: 'Tool not found' };
      }

      const currentStatus = await getToolStatus(tool);
      if (currentStatus.isInstalled) {
        return { success: false, error: 'Tool is already installed' };
      }

      log.info(`[CLI Tools] Installing ${tool.name}...`);
      const installResult = await execAsync(tool.installCommand, {
        timeout: 300000, // 5 minutes
      });

      const newStatus = await getToolStatus(tool);

      return {
        success: newStatus.isInstalled,
        data: {
          tool: { ...tool, ...newStatus },
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
        return { success: false, error: 'Tool not found or update not supported' };
      }

      const currentStatus = await getToolStatus(tool);
      if (!currentStatus.isInstalled) {
        return { success: false, error: 'Tool is not installed' };
      }

      const previousVersion = currentStatus.version;

      log.info(`[CLI Tools] Updating ${tool.name}...`);
      const updateResult = await execAsync(tool.updateCommand, {
        timeout: 300000, // 5 minutes
      });

      const newStatus = await getToolStatus(tool);

      return {
        success: true,
        data: {
          tool: { ...tool, ...newStatus },
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
        return { success: false, error: 'Tool not found or authentication not supported' };
      }

      const currentStatus = await getToolStatus(tool);
      if (!currentStatus.isInstalled) {
        return { success: false, error: 'Tool is not installed' };
      }

      if (interactive) {
        // For interactive auth, return instructions for the user to run manually
        return {
          success: true,
          data: {
            interactive: true,
            command: tool.authCommand,
            message: `Please run the following command in your terminal to authenticate ${tool.name}: ${tool.authCommand}`,
          },
        };
      }

      const newStatus = await getToolStatus(tool);

      return {
        success: true,
        data: {
          tool: { ...tool, ...newStatus },
          isAuthenticated: newStatus.isAuthenticated,
          message: newStatus.isAuthenticated
            ? `${tool.name} is authenticated`
            : `${tool.name} requires authentication. Run: ${tool.authCommand}`,
        },
      };
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
        return { success: false, error: 'Tool not found' };
      }

      const installationSteps = generateInstallationGuide(tool);

      return {
        success: true,
        data: {
          tool,
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
