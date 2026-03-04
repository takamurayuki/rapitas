'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Bot,
  Zap,
  Shield,
  Scale,
  Key,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Save,
  Loader2,
  Terminal,
  Activity,
  Search,
  Play,
  GitBranch,
  Bell,
  FileSearch,
  Eye,
  EyeOff,
  Trash2,
  Plus,
} from 'lucide-react';
import type {
  DeveloperModeConfig,
  AIAgentConfig,
  TaskAnalysisConfig,
  AgentExecutionConfig,
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  BranchStrategy,
  ReviewScope,
  ApiProvider,
  ApiKeyStatus,
} from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { validateName } from '@/utils/validation';

type TabId = 'task-analysis' | 'agent-execution';

type Props = {
  config: DeveloperModeConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    updates: Partial<DeveloperModeConfig>,
  ) => Promise<DeveloperModeConfig | null>;
  selectedAgentConfigId?: number | null;
  onAgentConfigChange?: (agentConfigId: number | null) => void;
  taskId?: number;
};

const AGENT_TYPE_INFO: Record<
  string,
  { icon: typeof Bot; color: string; label: string }
> = {
  'claude-code': {
    icon: Terminal,
    color: 'text-orange-500',
    label: 'Claude Code',
  },
  codex: { icon: Zap, color: 'text-green-500', label: 'Codex CLI' },
  gemini: { icon: Activity, color: 'text-blue-500', label: 'Gemini CLI' },
};

const TABS: { id: TabId; label: string; icon: typeof Search }[] = [
  { id: 'task-analysis', label: 'タスク分析', icon: Search },
  { id: 'agent-execution', label: 'エージェント実行', icon: Play },
];

export function DeveloperModeConfigModal({
  config,
  isOpen,
  onClose,
  onSave,
  selectedAgentConfigId,
  onAgentConfigChange,
  taskId,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('task-analysis');
  const [autoApprove, setAutoApprove] = useState(config?.autoApprove ?? false);
  const [notifyInApp, setNotifyInApp] = useState(config?.notifyInApp ?? true);
  const [maxSubtasks, setMaxSubtasks] = useState(config?.maxSubtasks ?? 10);
  const [priority, setPriority] = useState<string>(
    config?.priority ?? 'balanced',
  );
  const [isSaving, setIsSaving] = useState(false);

  // エージェント選択関連の状態
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  // タスク分析設定の状態
  const [analysisAgentConfigId, setAnalysisAgentConfigId] = useState<
    number | null
  >(null);
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>('standard');
  const [analysisMaxSubtasks, setAnalysisMaxSubtasks] = useState(10);
  const [priorityStrategy, setPriorityStrategy] =
    useState<PriorityStrategy>('balanced');
  const [includeEstimates, setIncludeEstimates] = useState(true);
  const [includeDependencies, setIncludeDependencies] = useState(true);
  const [includeTips, setIncludeTips] = useState(true);
  const [promptStrategy, setPromptStrategy] = useState<PromptStrategy>('auto');
  const [autoApproveSubtasks, setAutoApproveSubtasks] = useState(false);
  const [autoOptimizePrompt, setAutoOptimizePrompt] = useState(false);
  const [analysisNotifyOnComplete, setAnalysisNotifyOnComplete] =
    useState(true);

  // エージェント実行設定の状態
  const [executionAgentConfigId, setExecutionAgentConfigId] = useState<
    number | null
  >(null);
  const [branchStrategy, setBranchStrategy] = useState<BranchStrategy>('auto');
  const [branchPrefix, setBranchPrefix] = useState('feature/');
  const [autoCommit, setAutoCommit] = useState(false);
  const [autoCreatePR, setAutoCreatePR] = useState(false);
  const [autoMergePR, setAutoMergePR] = useState(false);
  const [mergeCommitThreshold, setMergeCommitThreshold] = useState(5);
  const [autoExecuteOnAnalysis, setAutoExecuteOnAnalysis] = useState(false);
  const [useOptimizedPrompt, setUseOptimizedPrompt] = useState(true);
  const [autoCodeReview, setAutoCodeReview] = useState(true);
  const [reviewScope, setReviewScope] = useState<ReviewScope>('changes');
  const [execNotifyOnStart, setExecNotifyOnStart] = useState(true);
  const [execNotifyOnComplete, setExecNotifyOnComplete] = useState(true);
  const [execNotifyOnError, setExecNotifyOnError] = useState(true);

  // 設定読み込み状態
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);

  // APIキーステータス（全プロバイダ）
  const [apiKeyStatuses, setApiKeyStatuses] = useState<
    Record<ApiProvider, ApiKeyStatus>
  >({
    claude: { configured: false, maskedKey: null },
    chatgpt: { configured: false, maskedKey: null },
    gemini: { configured: false, maskedKey: null },
  });
  const [isLoadingApiKeys, setIsLoadingApiKeys] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // インラインエージェント追加用の状態
  const [showInlineAddAgent, setShowInlineAddAgent] = useState(false);
  const [inlineAgentName, setInlineAgentName] = useState('');
  const [inlineAgentType, setInlineAgentType] = useState('claude-code');
  const [inlineAgentDefault, setInlineAgentDefault] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [inlineAgentError, setInlineAgentError] = useState<string | null>(null);
  const [inlineAgentNameError, setInlineAgentNameError] = useState<
    string | null
  >(null);

  // インラインAPIキー設定用の状態
  const [apiKeyProvider, setApiKeyProvider] = useState<ApiProvider>('claude');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyValidationError, setApiKeyValidationError] = useState<
    string | null
  >(null);
  const [apiKeySuccessMessage, setApiKeySuccessMessage] = useState<
    string | null
  >(null);

  // モーダルが開かれた時にデータを取得
  useEffect(() => {
    if (isOpen) {
      fetchAllApiKeys();
      fetchAgents();
      if (taskId) {
        fetchConfigs();
      }
    }
  }, [isOpen, taskId]);

  // 外部からのselectedAgentConfigIdの変更を反映
  useEffect(() => {
    if (selectedAgentConfigId !== undefined && selectedAgentConfigId !== null) {
      // 初期値として両方のタブに設定（既存の設定がない場合のフォールバック）
      if (!analysisAgentConfigId)
        setAnalysisAgentConfigId(selectedAgentConfigId);
      if (!executionAgentConfigId)
        setExecutionAgentConfigId(selectedAgentConfigId);
    }
  }, [selectedAgentConfigId]);

  const fetchConfigs = async () => {
    if (!taskId) return;
    setIsLoadingConfigs(true);
    try {
      const [analysisRes, executionRes] = await Promise.all([
        fetch(`${API_BASE_URL}/task-analysis-config/${taskId}`),
        fetch(`${API_BASE_URL}/agent-execution-config/${taskId}`),
      ]);

      if (analysisRes.ok) {
        const data: TaskAnalysisConfig = await analysisRes.json();
        setAnalysisAgentConfigId(data.agentConfigId ?? null);
        setAnalysisDepth(data.analysisDepth);
        setAnalysisMaxSubtasks(data.maxSubtasks);
        setPriorityStrategy(data.priorityStrategy);
        setIncludeEstimates(data.includeEstimates);
        setIncludeDependencies(data.includeDependencies);
        setIncludeTips(data.includeTips);
        setPromptStrategy(data.promptStrategy);
        setAutoApproveSubtasks(data.autoApproveSubtasks);
        setAutoOptimizePrompt(data.autoOptimizePrompt);
        setAnalysisNotifyOnComplete(data.notifyOnComplete);
      }

      if (executionRes.ok) {
        const data: AgentExecutionConfig = await executionRes.json();
        setExecutionAgentConfigId(data.agentConfigId ?? null);
        setBranchStrategy(data.branchStrategy);
        setBranchPrefix(data.branchPrefix);
        setAutoCommit(data.autoCommit);
        setAutoCreatePR(data.autoCreatePR);
        setAutoMergePR(data.autoMergePR ?? false);
        setMergeCommitThreshold(data.mergeCommitThreshold ?? 5);
        setAutoExecuteOnAnalysis(data.autoExecuteOnAnalysis);
        setUseOptimizedPrompt(data.useOptimizedPrompt);
        setAutoCodeReview(data.autoCodeReview);
        setReviewScope(data.reviewScope);
        setExecNotifyOnStart(data.notifyOnStart);
        setExecNotifyOnComplete(data.notifyOnComplete);
        setExecNotifyOnError(data.notifyOnError);
      }
    } catch (err) {
      console.error('設定の取得に失敗:', err);
    } finally {
      setIsLoadingConfigs(false);
    }
  };

  const setDefaultAgent = async (agentId: number) => {
    setIsSettingDefault(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) {
        await fetchAgents();
      } else {
        console.error('デフォルトエージェントの設定に失敗:', await res.text());
      }
    } catch (err) {
      console.error('デフォルトエージェントの設定に失敗:', err);
    } finally {
      setIsSettingDefault(false);
    }
  };

  const fetchAgents = async () => {
    setIsLoadingAgents(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
        // デフォルトエージェントが選択されていない場合、isDefaultのエージェントを選択
        const defaultAgent = data.find((a: AIAgentConfig) => a.isDefault);
        if (defaultAgent) {
          if (!analysisAgentConfigId) setAnalysisAgentConfigId(defaultAgent.id);
          if (!executionAgentConfigId)
            setExecutionAgentConfigId(defaultAgent.id);
        }
      }
    } catch (err) {
      console.error('エージェント一覧の取得に失敗:', err);
    } finally {
      setIsLoadingAgents(false);
    }
  };

  const fetchAllApiKeys = async () => {
    setIsLoadingApiKeys(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-keys`);
      if (res.ok) {
        const data = await res.json();
        setApiKeyStatuses({
          claude: data.claude ?? { configured: false, maskedKey: null },
          chatgpt: data.chatgpt ?? { configured: false, maskedKey: null },
          gemini: data.gemini ?? { configured: false, maskedKey: null },
        });
      }
    } catch (err) {
      console.error('APIキー情報の取得に失敗:', err);
    } finally {
      setIsLoadingApiKeys(false);
    }
  };

  // APIキープロバイダ情報
  const API_KEY_PROVIDERS: {
    value: ApiProvider;
    label: string;
    placeholder: string;
    link: string;
  }[] = [
    {
      value: 'claude',
      label: 'Claude (Anthropic)',
      placeholder: 'sk-ant-api...',
      link: 'https://console.anthropic.com/',
    },
    {
      value: 'chatgpt',
      label: 'ChatGPT (OpenAI)',
      placeholder: 'sk-proj-...',
      link: 'https://platform.openai.com/api-keys',
    },
    {
      value: 'gemini',
      label: 'Gemini (Google)',
      placeholder: 'AIza...',
      link: 'https://aistudio.google.com/apikey',
    },
  ];

  // クライアントサイドAPIキーバリデーション
  const validateApiKeyForProvider = (
    apiKey: string,
    provider: ApiProvider,
  ): { valid: boolean; error?: string } => {
    const trimmed = apiKey.trim();
    if (!trimmed) return { valid: false, error: 'APIキーを入力してください' };
    if (trimmed.length < 10)
      return {
        valid: false,
        error: 'APIキーが短すぎます（10文字以上必要です）',
      };
    switch (provider) {
      case 'claude':
        if (!trimmed.startsWith('sk-ant-api'))
          return {
            valid: false,
            error: 'Claude APIキーは「sk-ant-api」で始まる必要があります',
          };
        break;
      case 'chatgpt':
        if (!trimmed.startsWith('sk-'))
          return {
            valid: false,
            error: 'OpenAI APIキーは「sk-」で始まる必要があります',
          };
        if (trimmed.startsWith('sk-ant-api'))
          return {
            valid: false,
            error: 'これはClaude APIキーです。OpenAI APIキーを入力してください',
          };
        break;
      case 'gemini':
        if (!trimmed.startsWith('AIza'))
          return {
            valid: false,
            error: 'Gemini APIキーは「AIza」で始まる必要があります',
          };
        break;
    }
    return { valid: true };
  };

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    const validation = validateApiKeyForProvider(apiKeyInput, apiKeyProvider);
    if (!validation.valid) {
      setApiKeyValidationError(validation.error ?? null);
      return;
    }
    setIsSavingApiKey(true);
    setApiKeyValidationError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput, provider: apiKeyProvider }),
      });
      if (res.ok) {
        const data = await res.json();
        setApiKeyStatuses((prev) => ({
          ...prev,
          [apiKeyProvider]: { configured: true, maskedKey: data.maskedKey },
        }));
        setApiKeyInput('');
        setShowApiKey(false);
        setApiKeySuccessMessage(
          `${API_KEY_PROVIDERS.find((p) => p.value === apiKeyProvider)?.label} のAPIキーを保存しました`,
        );
        setTimeout(() => setApiKeySuccessMessage(null), 3000);
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? '保存に失敗しました');
      }
    } catch (err) {
      setApiKeyValidationError(
        err instanceof Error ? err.message : 'エラーが発生しました',
      );
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const deleteApiKey = async (provider: ApiProvider) => {
    setIsSavingApiKey(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/settings/api-key?provider=${provider}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        setApiKeyStatuses((prev) => ({
          ...prev,
          [provider]: { configured: false, maskedKey: null },
        }));
        setApiKeySuccessMessage(`APIキーを削除しました`);
        setTimeout(() => setApiKeySuccessMessage(null), 3000);
      }
    } catch (err) {
      console.error('APIキー削除に失敗:', err);
    } finally {
      setIsSavingApiKey(false);
    }
  };

  // インラインエージェント追加
  const saveInlineAgent = async () => {
    setInlineAgentError(null);
    setInlineAgentNameError(null);

    const nameResult = validateName(inlineAgentName, 'エージェント名', 1, 50);
    if (!nameResult.valid) {
      setInlineAgentNameError(nameResult.error ?? null);
      return;
    }

    setIsSavingAgent(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inlineAgentName,
          agentType: inlineAgentType,
          isDefault: inlineAgentDefault,
        }),
      });

      if (res.ok) {
        setInlineAgentName('');
        setInlineAgentType('claude-code');
        setInlineAgentDefault(false);
        setShowInlineAddAgent(false);
        await fetchAgents();
      } else {
        const data = await res.json().catch(() => null);
        setInlineAgentError(data?.error ?? 'エージェントの追加に失敗しました');
      }
    } catch {
      setInlineAgentError('エージェントの追加に失敗しました');
    } finally {
      setIsSavingAgent(false);
    }
  };

  // APIキー不要なCLIベースのエージェントタイプ
  const CLI_AGENT_TYPES = ['claude-code', 'codex', 'gemini'];

  // APIキーが設定されているプロバイダに対応するエージェントタイプのマッピング
  const PROVIDER_TO_AGENT_TYPES: Record<ApiProvider, string[]> = {
    claude: ['anthropic-api'],
    chatgpt: ['openai', 'azure-openai'],
    gemini: ['gemini'],
  };

  // 利用可能なエージェントのフィルタリング（CLIベースは常に利用可能）
  const getAvailableAgents = () => {
    const configuredProviders = (
      Object.keys(apiKeyStatuses) as ApiProvider[]
    ).filter((provider) => apiKeyStatuses[provider].configured);
    const allowedAgentTypes = configuredProviders.flatMap(
      (provider) => PROVIDER_TO_AGENT_TYPES[provider],
    );
    return agents.filter(
      (agent) =>
        CLI_AGENT_TYPES.includes(agent.agentType) ||
        allowedAgentTypes.includes(agent.agentType),
    );
  };

  const hasAnyApiKey = Object.values(apiKeyStatuses).some((s) => s.configured);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);

    try {
      // 1. 開発者モード基本設定を保存
      onAgentConfigChange?.(analysisAgentConfigId ?? executionAgentConfigId);
      await onSave({
        autoApprove,
        notifyInApp,
        maxSubtasks,
        priority: priority as DeveloperModeConfig['priority'],
      });

      // 2. タスク分析設定を保存（taskIdがある場合）
      if (taskId) {
        const analysisBody = {
          agentConfigId: analysisAgentConfigId,
          analysisDepth,
          maxSubtasks: analysisMaxSubtasks,
          priorityStrategy,
          includeEstimates,
          includeDependencies,
          includeTips,
          promptStrategy,
          autoApproveSubtasks,
          autoOptimizePrompt,
          notifyOnComplete: analysisNotifyOnComplete,
        };

        const analysisRes = await fetch(
          `${API_BASE_URL}/task-analysis-config/${taskId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(analysisBody),
          },
        );

        if (!analysisRes.ok) {
          const errData = await analysisRes.json().catch(() => ({}));
          throw new Error(
            errData.error || 'タスク分析設定の保存に失敗しました',
          );
        }

        // 3. エージェント実行設定を保存
        const executionBody = {
          agentConfigId: executionAgentConfigId,
          branchStrategy,
          branchPrefix,
          autoCommit,
          autoCreatePR,
          autoMergePR,
          mergeCommitThreshold,
          autoExecuteOnAnalysis,
          useOptimizedPrompt,
          autoCodeReview,
          reviewScope,
          notifyOnStart: execNotifyOnStart,
          notifyOnComplete: execNotifyOnComplete,
          notifyOnError: execNotifyOnError,
        };

        const executionRes = await fetch(
          `${API_BASE_URL}/agent-execution-config/${taskId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(executionBody),
          },
        );

        if (!executionRes.ok) {
          const errData = await executionRes.json().catch(() => ({}));
          throw new Error(
            errData.error || 'エージェント実行設定の保存に失敗しました',
          );
        }
      }

      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const priorityOptions = [
    {
      value: 'conservative',
      label: '慎重',
      icon: Shield,
      description: '少数の大きなサブタスクに分解',
    },
    {
      value: 'balanced',
      label: 'バランス',
      icon: Scale,
      description: '適度な粒度で分解（推奨）',
    },
    {
      value: 'aggressive',
      label: '詳細',
      icon: Zap,
      description: '細かいサブタスクに詳細分解',
    },
  ];

  const getAgentTypeInfo = (agentType: string) => {
    return (
      AGENT_TYPE_INFO[agentType] || {
        icon: Bot,
        color: 'text-zinc-500',
        label: agentType,
      }
    );
  };

  // インラインエージェント追加フォーム
  const renderInlineAddAgentForm = () => (
    <div className="mt-3 p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            エージェントを追加
          </span>
        </div>
        <button
          onClick={() => {
            setShowInlineAddAgent(false);
            setInlineAgentError(null);
            setInlineAgentNameError(null);
          }}
          className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={inlineAgentName}
          onChange={(e) => {
            setInlineAgentName(e.target.value);
            if (e.target.value.trim()) {
              const result = validateName(
                e.target.value,
                'エージェント名',
                1,
                50,
              );
              setInlineAgentNameError(
                result.valid ? null : (result.error ?? null),
              );
            } else {
              setInlineAgentNameError(null);
            }
          }}
          placeholder="例: メイン開発エージェント"
          className={`w-full px-2.5 py-1.5 bg-white dark:bg-indigo-dark-900 border rounded text-xs focus:outline-none focus:ring-2 transition-all ${
            inlineAgentNameError
              ? 'border-red-400 dark:border-red-600 focus:ring-red-500/20'
              : 'border-zinc-200 dark:border-zinc-700 focus:ring-violet-500/20 focus:border-violet-500'
          }`}
        />
        {inlineAgentNameError && (
          <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {inlineAgentNameError}
          </p>
        )}

        <select
          value={inlineAgentType}
          onChange={(e) => setInlineAgentType(e.target.value)}
          className="w-full px-2.5 py-1.5 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 rounded text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex CLI</option>
          <option value="gemini">Gemini CLI</option>
        </select>

        <label className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={inlineAgentDefault}
            onChange={(e) => setInlineAgentDefault(e.target.checked)}
            className="w-3 h-3 text-violet-600 border-zinc-300 rounded focus:ring-violet-500"
          />
          デフォルトに設定
        </label>
      </div>

      {inlineAgentError && (
        <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {inlineAgentError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => {
            setShowInlineAddAgent(false);
            setInlineAgentError(null);
            setInlineAgentNameError(null);
          }}
          className="px-2 py-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          キャンセル
        </button>
        <button
          onClick={saveInlineAgent}
          disabled={!inlineAgentName.trim() || isSavingAgent}
          className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
        >
          {isSavingAgent ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          追加
        </button>
      </div>
    </div>
  );

  // エージェント選択UI（ドロップダウン型、共通コンポーネント）
  const renderAgentSelector = (
    selectedId: number | null,
    onSelect: (id: number | null) => void,
    label: string,
    filterByApiKey: boolean = false,
  ) => {
    if (isLoadingAgents || isLoadingApiKeys) {
      return (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          読み込み中...
        </div>
      );
    }

    const displayAgents = filterByApiKey ? getAvailableAgents() : agents;

    // エージェント未設定時：インライン追加フォームを表示
    if (displayAgents.length === 0 && agents.length === 0) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            エージェントが設定されていません。
          </p>
          {showInlineAddAgent ? (
            renderInlineAddAgentForm()
          ) : (
            <button
              onClick={() => setShowInlineAddAgent(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-violet-600 dark:text-violet-400 border border-violet-300 dark:border-violet-700 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              エージェントを追加
            </button>
          )}
        </div>
      );
    }

    const selectedAgent = displayAgents.find((a) => a.id === selectedId);

    // APIキーが設定されていないプロバイダのエージェントがあるかチェック
    const hasUnconfiguredApiKeyAgents =
      filterByApiKey &&
      agents.some(
        (agent) =>
          !CLI_AGENT_TYPES.includes(agent.agentType) &&
          !displayAgents.some((da) => da.id === agent.id),
      );

    return (
      <div className="space-y-2">
        {/* ドロップダウン + 追加ボタン */}
        <div className="flex items-center gap-2">
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onSelect(val ? Number(val) : null);
            }}
            className="flex-1 px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
          >
            <option value="">モデルを選択...</option>
            {displayAgents.map((agent) => {
              const typeInfo = getAgentTypeInfo(agent.agentType);
              return (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({typeInfo.label}
                  {agent.modelId ? ` · ${agent.modelId}` : ''})
                  {agent.isDefault ? ' [デフォルト]' : ''}
                </option>
              );
            })}
          </select>
          <button
            onClick={() => setShowInlineAddAgent(!showInlineAddAgent)}
            className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
              showInlineAddAgent
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-400 dark:hover:border-violet-500'
            }`}
            title="エージェントを追加"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* インラインエージェント追加フォーム */}
        {showInlineAddAgent && renderInlineAddAgentForm()}

        {/* 選択中のエージェント情報 */}
        {selectedAgent && (
          <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800">
            {(() => {
              const typeInfo = getAgentTypeInfo(selectedAgent.agentType);
              const TypeIcon = typeInfo.icon;
              return (
                <>
                  <TypeIcon
                    className={`w-4 h-4 flex-shrink-0 ${typeInfo.color}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-violet-700 dark:text-violet-300 truncate">
                        {selectedAgent.name}
                      </span>
                      {selectedAgent.isDefault ? (
                        <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px] font-medium">
                          デフォルト
                        </span>
                      ) : (
                        <button
                          onClick={() => setDefaultAgent(selectedAgent.id)}
                          disabled={isSettingDefault}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 border border-zinc-300 dark:border-zinc-600 hover:border-violet-400 dark:hover:border-violet-500 rounded transition-colors disabled:opacity-50"
                        >
                          {isSettingDefault ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <CheckCircle className="w-3 h-3" />
                          )}
                          デフォルトに設定
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {typeInfo.label}
                      {selectedAgent.modelId && ` · ${selectedAgent.modelId}`}
                    </span>
                  </div>
                  <CheckCircle className="w-4 h-4 flex-shrink-0 text-violet-500" />
                </>
              );
            })()}
          </div>
        )}

        {/* APIキー未設定のエージェントがある場合にインラインAPIキー設定を表示 */}
        {hasUnconfiguredApiKeyAgents && renderInlineApiKeySetup()}
      </div>
    );
  };

  // インラインAPIキー設定UI
  const renderInlineApiKeySetup = () => {
    const currentProvider = API_KEY_PROVIDERS.find(
      (p) => p.value === apiKeyProvider,
    )!;
    const currentStatus = apiKeyStatuses[apiKeyProvider];

    return (
      <div className="mt-3 p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            APIキー設定
          </span>
          <span className="text-[10px] text-zinc-400">
            （APIが必要なモデルを有効化）
          </span>
        </div>

        {/* プロバイダ選択タブ */}
        <div className="flex gap-1.5">
          {API_KEY_PROVIDERS.map((provider) => {
            const status = apiKeyStatuses[provider.value];
            const isSelected = apiKeyProvider === provider.value;
            return (
              <button
                key={provider.value}
                onClick={() => {
                  setApiKeyProvider(provider.value);
                  setApiKeyInput('');
                  setShowApiKey(false);
                  setApiKeyValidationError(null);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                  isSelected
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                    : 'border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-500'
                }`}
              >
                {status.configured ? (
                  <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                ) : (
                  <AlertCircle className="w-2.5 h-2.5 text-zinc-400" />
                )}
                {provider.label}
              </button>
            );
          })}
        </div>

        {/* 設定済みの場合 */}
        {currentStatus.configured && currentStatus.maskedKey && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <code className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 truncate">
                {currentStatus.maskedKey}
              </code>
            </div>
            <button
              onClick={() => deleteApiKey(apiKeyProvider)}
              disabled={isSavingApiKey}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-red-500 hover:text-red-600 dark:text-red-400 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              削除
            </button>
          </div>
        )}

        {/* 未設定の場合：入力フォーム */}
        {!currentStatus.configured && (
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  if (apiKeyValidationError) setApiKeyValidationError(null);
                }}
                placeholder={currentProvider.placeholder}
                className={`w-full px-2.5 py-1.5 pr-8 bg-white dark:bg-indigo-dark-900 border rounded text-xs focus:outline-none focus:ring-2 transition-all ${
                  apiKeyValidationError
                    ? 'border-red-400 dark:border-red-600 focus:ring-red-500/20'
                    : 'border-zinc-200 dark:border-zinc-700 focus:ring-violet-500/20 focus:border-violet-500'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {showApiKey ? (
                  <EyeOff className="w-3 h-3" />
                ) : (
                  <Eye className="w-3 h-3" />
                )}
              </button>
            </div>
            {apiKeyValidationError && (
              <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                {apiKeyValidationError}
              </p>
            )}
            <div className="flex items-center justify-between">
              <a
                href={currentProvider.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
              >
                APIキーを取得
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <button
                onClick={saveApiKey}
                disabled={!apiKeyInput.trim() || isSavingApiKey}
                className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
              >
                {isSavingApiKey ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                保存
              </button>
            </div>
          </div>
        )}

        {/* 成功メッセージ */}
        {apiKeySuccessMessage && (
          <p className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            {apiKeySuccessMessage}
          </p>
        )}
      </div>
    );
  };

  // トグルスイッチ（共通コンポーネント）
  const renderToggle = (
    value: boolean,
    onChange: (v: boolean) => void,
    label: string,
    description: string,
  ) => (
    <div className="flex items-center justify-between">
      <div>
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
          value ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            value ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );

  // タスク分析タブの内容
  const renderTaskAnalysisTab = () => (
    <div className="space-y-5">
      {/* AIエージェント選択 */}
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            分析用AIエージェント
          </label>
        </div>
        {renderAgentSelector(
          analysisAgentConfigId,
          setAnalysisAgentConfigId,
          '分析用AIエージェント',
          true,
        )}
      </div>

      {/* 分析深度 */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          分析深度
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              value: 'quick' as const,
              label: 'クイック',
              desc: '素早い概要分析',
            },
            {
              value: 'standard' as const,
              label: '標準',
              desc: 'バランスの良い分析',
            },
            { value: 'deep' as const, label: '詳細', desc: '深い詳細分析' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAnalysisDepth(opt.value)}
              className={`p-2.5 rounded-lg border text-center transition-all ${
                analysisDepth === opt.value
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  analysisDepth === opt.value
                    ? 'text-violet-700 dark:text-violet-300'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 分解レベル */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          優先度戦略
        </label>
        <div className="grid grid-cols-3 gap-2">
          {priorityOptions.map((option) => (
            <button
              key={option.value}
              onClick={() =>
                setPriorityStrategy(option.value as PriorityStrategy)
              }
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all ${
                priorityStrategy === option.value
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <option.icon
                className={`w-4 h-4 ${
                  priorityStrategy === option.value
                    ? 'text-violet-600 dark:text-violet-400'
                    : 'text-zinc-400'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  priorityStrategy === option.value
                    ? 'text-violet-700 dark:text-violet-300'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {
            priorityOptions.find((o) => o.value === priorityStrategy)
              ?.description
          }
        </p>
      </div>

      {/* プロンプト戦略 */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          プロンプト戦略
        </label>
        <select
          value={promptStrategy}
          onChange={(e) => setPromptStrategy(e.target.value as PromptStrategy)}
          className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="auto">自動</option>
          <option value="detailed">詳細</option>
          <option value="concise">簡潔</option>
          <option value="custom">カスタム</option>
        </select>
      </div>

      {/* 最大サブタスク数 */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          最大サブタスク数: {analysisMaxSubtasks}
        </label>
        <input
          type="range"
          min={3}
          max={20}
          value={analysisMaxSubtasks}
          onChange={(e) => setAnalysisMaxSubtasks(parseInt(e.target.value))}
          className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
        />
        <div className="flex justify-between text-xs text-zinc-400 mt-1">
          <span>3</span>
          <span>20</span>
        </div>
      </div>

      {/* 出力オプション */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          出力オプション
        </label>
        {renderToggle(
          includeEstimates,
          setIncludeEstimates,
          '工数見積もり',
          '各サブタスクの見積もり時間を含める',
        )}
        {renderToggle(
          includeDependencies,
          setIncludeDependencies,
          '依存関係',
          'サブタスク間の依存関係を含める',
        )}
        {renderToggle(
          includeTips,
          setIncludeTips,
          '実装ヒント',
          '実装のヒントやアドバイスを含める',
        )}
      </div>

      {/* 自動化設定 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          自動化
        </label>
        {renderToggle(
          autoApproveSubtasks,
          setAutoApproveSubtasks,
          'サブタスク自動承認',
          '分析結果のサブタスクを自動承認',
        )}
        {renderToggle(
          autoOptimizePrompt,
          setAutoOptimizePrompt,
          'プロンプト自動最適化',
          '分析前にプロンプトを自動最適化',
        )}
        {renderToggle(
          analysisNotifyOnComplete,
          setAnalysisNotifyOnComplete,
          '完了通知',
          '分析完了時に通知を送信',
        )}
      </div>
    </div>
  );

  // エージェント実行タブの内容
  const renderAgentExecutionTab = () => (
    <div className="space-y-5">
      {/* AIエージェント選択 */}
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            実行用AIエージェント
          </label>
        </div>
        {renderAgentSelector(
          executionAgentConfigId,
          setExecutionAgentConfigId,
          '実行用AIエージェント',
          true,
        )}
      </div>

      {/* Git設定 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Git設定
          </label>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            ブランチ戦略
          </label>
          <select
            value={branchStrategy}
            onChange={(e) =>
              setBranchStrategy(e.target.value as BranchStrategy)
            }
            className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
          >
            <option value="auto">自動（推奨）</option>
            <option value="manual">手動</option>
            <option value="none">なし</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            ブランチプレフィックス
          </label>
          <input
            type="text"
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            placeholder="feature/"
          />
        </div>

        {renderToggle(
          autoCommit,
          setAutoCommit,
          '自動コミット',
          '変更を自動的にコミット',
        )}
        {renderToggle(
          autoCreatePR,
          setAutoCreatePR,
          '自動PR作成',
          '完了時にPull Requestを自動作成',
        )}
        {autoCreatePR && (
          <>
            {renderToggle(
              autoMergePR,
              setAutoMergePR,
              '自動マージ',
              'PR作成後に自動でマージ（squash/merge）',
            )}
            {autoMergePR && (
              <div className="ml-4 flex items-center gap-2">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  Squashマージ閾値
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={mergeCommitThreshold}
                  onChange={(e) =>
                    setMergeCommitThreshold(
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  コミット以上でsquash
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* コードレビュー設定 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            コードレビュー
          </label>
        </div>

        {renderToggle(
          autoCodeReview,
          setAutoCodeReview,
          '自動コードレビュー',
          '実行完了後に自動でコードレビュー',
        )}

        {autoCodeReview && (
          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              レビュー範囲
            </label>
            <select
              value={reviewScope}
              onChange={(e) => setReviewScope(e.target.value as ReviewScope)}
              className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            >
              <option value="changes">変更箇所のみ</option>
              <option value="full">全体</option>
              <option value="none">なし</option>
            </select>
          </div>
        )}
      </div>

      {/* 実行オプション */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            実行オプション
          </label>
        </div>
        {renderToggle(
          autoExecuteOnAnalysis,
          setAutoExecuteOnAnalysis,
          '分析後自動実行',
          'タスク分析完了後にエージェントを自動実行',
        )}
        {renderToggle(
          useOptimizedPrompt,
          setUseOptimizedPrompt,
          '最適化プロンプト使用',
          'タスク分析の最適化プロンプトを使用',
        )}
      </div>

      {/* 通知設定 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            通知設定
          </label>
        </div>
        {renderToggle(
          execNotifyOnStart,
          setExecNotifyOnStart,
          '実行開始通知',
          'エージェント実行開始時に通知',
        )}
        {renderToggle(
          execNotifyOnComplete,
          setExecNotifyOnComplete,
          '実行完了通知',
          'エージェント実行完了時に通知',
        )}
        {renderToggle(
          execNotifyOnError,
          setExecNotifyOnError,
          'エラー通知',
          'エラー発生時に通知',
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-indigo-dark-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              AIアシスタント設定
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* タブナビゲーション */}
        <div className="px-6 pt-4">
          <div
            className="flex border-b border-zinc-200 dark:border-zinc-700"
            role="tablist"
          >
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <TabIcon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* タブコンテンツ */}
        <div className="px-6 py-4 max-h-[50vh] overflow-y-auto">
          {isLoadingConfigs ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              設定を読み込み中...
            </div>
          ) : (
            <>
              <div
                role="tabpanel"
                id="tabpanel-task-analysis"
                hidden={activeTab !== 'task-analysis'}
              >
                {activeTab === 'task-analysis' && renderTaskAnalysisTab()}
              </div>
              <div
                role="tabpanel"
                id="tabpanel-agent-execution"
                hidden={activeTab !== 'agent-execution'}
              >
                {activeTab === 'agent-execution' && renderAgentExecutionTab()}
              </div>
            </>
          )}
        </div>

        {/* Save error */}
        {saveError && (
          <div className="flex items-center gap-2 px-6 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {saveError}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-indigo-dark-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                設定を保存
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
