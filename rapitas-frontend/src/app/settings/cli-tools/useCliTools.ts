'use client';
// use-cli-tools

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { CLITool, ToolsSummary, ToolActionState, AuthModalState } from './types';

export interface UseCLIToolsReturn {
  tools: CLITool[];
  summary: ToolsSummary | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  successMessage: string | null;
  actionStates: Record<string, ToolActionState>;
  authModal: AuthModalState;
  refreshTools: () => Promise<void>;
  installTool: (toolId: string) => Promise<void>;
  updateTool: (toolId: string) => Promise<void>;
  checkAuthentication: (toolId: string) => Promise<void>;
  showAuthModal: (tool: CLITool) => Promise<void>;
  closeAuthModal: () => void;
  verifyAuthentication: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  updateActionState: (toolId: string, updates: Partial<ToolActionState>) => void;
  setAuthModal: React.Dispatch<React.SetStateAction<AuthModalState>>;
}

/**
 * Manages CLI tool data fetching, install/update/auth actions, and modal state.
 *
 * @returns All state and handlers needed by the CLI Tools page.
 */
export function useCLITools(): UseCLIToolsReturn {
  const [tools, setTools] = useState<CLITool[]>([]);
  const [summary, setSummary] = useState<ToolsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionStates, setActionStates] = useState<Record<string, ToolActionState>>({});
  const [authModal, setAuthModal] = useState<AuthModalState>({
    isOpen: false,
    tool: null,
    command: null,
    step: 'command',
  });

  const updateActionState = (toolId: string, updates: Partial<ToolActionState>) => {
    setActionStates((prev) => ({
      ...prev,
      [toolId]: { ...prev[toolId], ...updates },
    }));
  };

  const showSuccess = (msg: string, ms = 5000) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), ms);
  };

  const fetchTools = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/cli-tools`);
      if (!response.ok) throw new Error('Failed to fetch CLI tools');
      const data = await response.json();
      if (data.success) {
        setTools(data.data.tools);
        setSummary(data.data.summary);
        // Initialize per-tool action state for freshly fetched tools
        const initialStates: Record<string, ToolActionState> = {};
        data.data.tools.forEach((tool: CLITool) => {
          initialStates[tool.id] = {
            isInstalling: false,
            isUpdating: false,
            isAuthenticating: false,
            showCommand: false,
          };
        });
        setActionStates(initialStates);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch CLI tools');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const installTool = async (toolId: string) => {
    updateActionState(toolId, { isInstalling: true });
    setError(null);
    try {
      const data = await fetch(`${API_BASE_URL}/cli-tools/${toolId}/install`, {
        method: 'POST',
      }).then((r) => r.json());
      if (data.success) {
        showSuccess(data.data.message);
        await fetchTools();
      } else throw new Error(data.error || 'Installation failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      updateActionState(toolId, { isInstalling: false });
    }
  };

  const updateTool = async (toolId: string) => {
    updateActionState(toolId, { isUpdating: true });
    setError(null);
    try {
      const data = await fetch(`${API_BASE_URL}/cli-tools/${toolId}/update`, {
        method: 'POST',
      }).then((r) => r.json());
      if (data.success) {
        showSuccess(data.data.message);
        await fetchTools();
      } else throw new Error(data.error || 'Update failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      updateActionState(toolId, { isUpdating: false });
    }
  };

  const checkAuthentication = async (toolId: string) => {
    updateActionState(toolId, { isAuthenticating: true });
    setError(null);
    try {
      const data = await fetch(`${API_BASE_URL}/cli-tools/${toolId}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactive: false }),
      }).then((r) => r.json());
      if (data.success) {
        if (data.data.isAuthenticated)
          showSuccess(`${data.data.tool.name} is already authenticated`);
        else setError(`${data.data.tool.name} requires authentication. ${data.data.message}`);
        setTimeout(() => {
          setSuccessMessage(null);
          setError(null);
        }, 5000);
        await fetchTools();
      } else throw new Error(data.error || 'Authentication check failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication check failed');
    } finally {
      updateActionState(toolId, { isAuthenticating: false });
    }
  };

  const showAuthModal = async (tool: CLITool) => {
    try {
      const data = await fetch(`${API_BASE_URL}/cli-tools/${tool.id}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactive: true }),
      }).then((r) => r.json());
      if (data.success && data.data.interactive) {
        setAuthModal({
          isOpen: true,
          tool,
          command: data.data.command,
          step: 'command',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get auth command');
    }
  };

  const closeAuthModal = () =>
    setAuthModal({ isOpen: false, tool: null, command: null, step: 'command' });

  const verifyAuthentication = async () => {
    if (!authModal.tool) return;
    updateActionState(authModal.tool.id, { isAuthenticating: true });
    try {
      const data = await fetch(`${API_BASE_URL}/cli-tools/${authModal.tool.id}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactive: false }),
      }).then((r) => r.json());
      if (data.success) {
        if (data.data.isAuthenticated) {
          setAuthModal((prev) => ({ ...prev, step: 'completed' }));
          await fetchTools();
          // Auto-close after showing the completion state for 3 s
          setTimeout(() => closeAuthModal(), 3000);
        } else {
          setError(
            `${authModal.tool.name}の認証が完了していません。ターミナルでコマンドを実行してください。`,
          );
        }
      } else throw new Error(data.error || 'Authentication verification failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication verification failed');
    } finally {
      if (authModal.tool) updateActionState(authModal.tool.id, { isAuthenticating: false });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('コマンドをクリップボードにコピーしました', 3000);
    } catch {
      setError('クリップボードへのコピーに失敗しました');
    }
  };

  const refreshTools = async () => {
    setIsRefreshing(true);
    await fetchTools();
  };

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  return {
    tools,
    summary,
    isLoading,
    isRefreshing,
    error,
    successMessage,
    actionStates,
    authModal,
    refreshTools,
    installTool,
    updateTool,
    checkAuthentication,
    showAuthModal,
    closeAuthModal,
    verifyAuthentication,
    copyToClipboard,
    updateActionState,
    setAuthModal,
  };
}
