/**
 * AgentVersionManagement — Shared types
 *
 * Domain types for the agent version management feature.
 * Not responsible for any rendering or data fetching logic.
 */

export interface AgentVersion {
  id: number;
  agentId: number;
  agentName: string;
  version: string;
  description: string;
  changelog: string;
  isStable: boolean;
  isInstalled: boolean;
  installationDate: string | null;
  createdAt: string;
  downloadUrl: string | null;
  size: number | null;
  dependencies: string[];
}

export interface AgentConfig {
  id: number;
  name: string;
  description: string;
  currentVersion: string | null;
  latestVersion: string;
  isInstalled: boolean;
  installationStatus: 'not_installed' | 'installing' | 'installed' | 'update_available' | 'error';
  lastUpdatedAt: string | null;
  autoUpdate: boolean;
}

export const statusStyles: Record<AgentConfig['installationStatus'], string> = {
  not_installed: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300',
  installing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  installed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  update_available: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};
