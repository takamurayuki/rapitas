/**
 * Agent Version Management
 *
 * Re-exports the version management routes and registry for backward compatibility.
 * Implementation has been split into sub-modules under routes/agents/agent-version/.
 */

export { agentVersionManagementRoutes } from './agent-version/version-routes';
export {
  AVAILABLE_AGENT_VERSIONS,
  getLatestVersionKey,
  getVersionChangeDescription,
} from './agent-version/version-registry';
export type { VersionInfo } from './agent-version/version-registry';
