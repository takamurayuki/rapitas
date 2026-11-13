/**
 * cli-tools/types
 *
 * Shared TypeScript interfaces for the CLI Tools settings page.
 * Does not contain any runtime logic — types only.
 */

export interface CLITool {
  id: string;
  name: string;
  description: string;
  category: 'ai' | 'development' | 'utility';
  officialSite: string;
  documentation: string;
  checkCommand: string;
  versionCommand: string;
  installCommand: string;
  updateCommand?: string;
  authCommand?: string;
  authCheck?: string;
  isInstalled: boolean;
  version: string | null;
  isAuthenticated: boolean;
  installPath?: string;
  status: 'authenticated' | 'installed' | 'not_installed';
  error?: string;
  releaseInfo?: {
    version: string;
    releaseDate: string;
    changelog: string;
    downloadUrl: string;
  };
}

export interface ToolsSummary {
  total: number;
  installed: number;
  authenticated: number;
  needsUpdate: number;
}

export interface ToolActionState {
  isInstalling: boolean;
  isUpdating: boolean;
  isAuthenticating: boolean;
  showCommand: boolean;
}

export interface AuthModalState {
  isOpen: boolean;
  tool: CLITool | null;
  command: string | null;
  step: 'command' | 'verify' | 'completed';
}
