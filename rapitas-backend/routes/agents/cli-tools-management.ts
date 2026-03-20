/**
 * CLI Tools Management API Routes (re-export)
 *
 * This file is kept for backward compatibility.
 * The implementation has been split into sub-modules under ./cli-tools/.
 */
export { cliToolsManagementRoutes, CLI_TOOLS, getToolStatus, getLatestReleaseInfo, checkAuthenticationStatus, generateInstallationGuide } from './cli-tools/index';
export type { CLITool, GitHubRelease } from './cli-tools/index';
