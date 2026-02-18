"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Key,
  Eye,
  EyeOff,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Save,
  TestTube2,
  AlertTriangle,
  Info,
  Cpu,
  Terminal,
  Zap,
  Activity,
  Globe,
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { API_BASE_URL } from "@/utils/api";
import {
  validateUrl,
  validateApiKey,
  collectErrors,
  validateConfigOnServer,
  type ValidationResult,
} from "@/utils/validation";

type AgentConfig = {
  id: number;
  agentType: string;
  name: string;
  endpoint?: string | null;
  modelId?: string | null;
  isDefault: boolean;
  isActive: boolean;
  capabilities: Record<string, boolean>;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

type ProviderConfig = {
  name: string;
  icon: React.ReactNode;
  color: string;
  defaultEndpoint?: string;
  defaultModel?: string;
  models: Array<{ id: string; name: string; description?: string }>;
  requiresApiKey: boolean;
  apiKeyPlaceholder: string;
  apiKeyHelpUrl?: string;
  endpointEditable: boolean;
};

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  "claude-code": {
    name: "Claude Code",
    icon: <Terminal className="w-5 h-5" />,
    color: "text-orange-500",
    defaultModel: "",
    models: [],
    requiresApiKey: false,
    apiKeyPlaceholder: "Claude CodeはローカルCLIを使用（APIキー不要）",
    endpointEditable: false,
  },
  "anthropic-api": {
    name: "Anthropic API",
    icon: <Terminal className="w-5 h-5" />,
    color: "text-orange-500",
    defaultEndpoint: "https://api.anthropic.com",
    defaultModel: "",
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: "sk-ant-api03-...",
    apiKeyHelpUrl: "https://console.anthropic.com/settings/keys",
    endpointEditable: false,
  },
  codex: {
    name: "Codex CLI",
    icon: <Zap className="w-5 h-5" />,
    color: "text-green-500",
    defaultModel: "",
    models: [],
    requiresApiKey: false,
    apiKeyPlaceholder:
      "Codex CLIはローカルCLIを使用（APIキー不要、ChatGPTアカウントで認証）",
    endpointEditable: false,
  },
  openai: {
    name: "OpenAI",
    icon: <Zap className="w-5 h-5" />,
    color: "text-green-500",
    defaultEndpoint: "https://api.openai.com/v1",
    defaultModel: "",
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: "sk-...",
    apiKeyHelpUrl: "https://platform.openai.com/api-keys",
    endpointEditable: true,
  },
  "azure-openai": {
    name: "Azure OpenAI",
    icon: <Globe className="w-5 h-5" />,
    color: "text-blue-500",
    defaultEndpoint: "",
    defaultModel: "",
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: "Azure API Key",
    apiKeyHelpUrl: "https://portal.azure.com",
    endpointEditable: true,
  },
  gemini: {
    name: "Gemini CLI",
    icon: <Activity className="w-5 h-5" />,
    color: "text-blue-500",
    defaultModel: "",
    models: [],
    requiresApiKey: false,
    apiKeyPlaceholder:
      "Gemini CLIはローカルCLIを使用（APIキー不要、Googleアカウントで認証）",
    endpointEditable: false,
  },
  custom: {
    name: "カスタム",
    icon: <Cpu className="w-5 h-5" />,
    color: "text-zinc-500",
    defaultEndpoint: "",
    defaultModel: "",
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: "APIキー",
    endpointEditable: true,
  },
};

export default function AgentSettingsClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);

  // Form state
  const [endpoint, setEndpoint] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});

  // Field-level validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>(
    {},
  );

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/${id}`);
      if (res.ok) {
        const data = await res.json();
        setAgent(data);
        setEndpoint(data.endpoint || "");
        setModelId(data.modelId || "");
        setCapabilities(data.capabilities || {});

        // Fetch available models for this agent type
        fetchModels(data.agentType);
      } else {
        setError("エージェントが見つかりません");
      }
    } catch (err) {
      console.error("Failed to fetch agent:", err);
      setError("エージェントの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id, fetchModels]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  const fetchModels = useCallback(async (agentType: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/models?type=${agentType}`);
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models || []);

        // Update provider config with fetched models
        if (PROVIDER_CONFIGS[agentType]) {
          PROVIDER_CONFIGS[agentType].models = data.models || [];
        }
      }
    } catch (err) {
      console.error("Failed to fetch models:", err);
    }
  }, []);

  const validateField = (field: string, value: string): string | null => {
    let result: ValidationResult;
    switch (field) {
      case "endpoint":
        result = validateUrl(
          value,
          "エンドポイント",
          agent?.agentType === "custom" || agent?.agentType === "azure-openai",
        );
        return result.valid ? null : (result.error ?? null);
      case "apiKey":
        if (!value.trim()) return null;
        result = validateApiKey(value, agent?.agentType);
        return result.valid ? null : (result.error ?? null);
      default:
        return null;
    }
  };

  const updateField = (
    field: string,
    value: string,
    setter: (v: string) => void,
  ) => {
    setter(value);
    if (value.trim()) {
      setFieldErrors((prev) => ({
        ...prev,
        [field]: validateField(field, value),
      }));
    } else {
      setFieldErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleSave = async () => {
    setError("");
    setSuccessMessage("");

    // Run all validations
    if (!agent) return;
    const provConfig =
      PROVIDER_CONFIGS[agent.agentType] || PROVIDER_CONFIGS["custom"];

    const endpointResult = provConfig.endpointEditable
      ? validateUrl(
          endpoint,
          "エンドポイント",
          agent.agentType === "custom" || agent.agentType === "azure-openai",
        )
      : ({ valid: true } as ValidationResult);
    const apiKeyResult = apiKey
      ? validateApiKey(apiKey, agent.agentType)
      : ({ valid: true } as ValidationResult);

    const { valid, errors } = collectErrors(
      endpointResult,
      apiKeyResult,
    );

    // Update field-level errors for visual feedback
    setFieldErrors({
      endpoint: endpointResult.valid ? null : (endpointResult.error ?? null),
      apiKey: apiKeyResult.valid ? null : (apiKeyResult.error ?? null),
    });

    if (!valid) {
      setError(errors.join("、"));
      return;
    }

    setSaving(true);

    try {
      // Server-side validation
      const serverResult = await validateConfigOnServer(API_BASE_URL, {
        agentType: agent.agentType,
        apiKey: apiKey || undefined,
        endpoint: endpoint || undefined,
        modelId: modelId || undefined,
      });

      if (!serverResult.valid) {
        setError(serverResult.errors.join("、"));
        setSaving(false);
        return;
      }

      // Update basic config
      const configRes = await fetch(`${API_BASE_URL}/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint || null,
          modelId: modelId || null,
          capabilities,
        }),
      });

      if (!configRes.ok) {
        throw new Error("設定の保存に失敗しました");
      }

      // Save API key if provided
      if (apiKey) {
        const keyRes = await fetch(`${API_BASE_URL}/agents/${id}/api-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });

        if (!keyRes.ok) {
          throw new Error("APIキーの保存に失敗しました");
        }
      }

      setFieldErrors({});
      setSuccessMessage("設定を保存しました");
      setApiKey("");
      await fetchAgent();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteApiKey = async () => {
    if (!confirm("APIキーを削除しますか？")) return;

    setError("");
    setSuccessMessage("");

    try {
      const res = await fetch(`${API_BASE_URL}/agents/${id}/api-key`, {
        method: "DELETE",
      });

      if (res.ok) {
        setSuccessMessage("APIキーを削除しました");
        await fetchAgent();
        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        throw new Error("APIキーの削除に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(`${API_BASE_URL}/agents/${id}/test`, {
        method: "POST",
      });

      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? "接続成功" : "接続失敗"),
      });
    } catch (err) {
      console.error("Failed to test connection:", err);
      setTestResult({
        success: false,
        message: "接続テストに失敗しました",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("このエージェント設定を削除しますか？")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/agents/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.push("/agents");
      } else {
        throw new Error("削除に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-5rem)] bg-background">
        <XCircle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-zinc-600 dark:text-zinc-400">
          {error || "エージェントが見つかりません"}
        </p>
        <Link
          href="/agents"
          className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          エージェント一覧に戻る
        </Link>
      </div>
    );
  }

  const providerConfig =
    PROVIDER_CONFIGS[agent.agentType] || PROVIDER_CONFIGS["custom"];

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/agents"
            className="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${providerConfig.color}`}
            >
              {providerConfig.icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {agent.name}
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400">
                {providerConfig.name}の設定
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-green-600 dark:text-green-400">
              {successMessage}
            </p>
          </div>
        )}

        {/* Basic Settings */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            基本設定
          </h2>

          <div className="space-y-4">
            {availableModels.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  モデル
                </label>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">モデルを選択</option>
                  {availableModels.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}{" "}
                      {model.description ? `- ${model.description}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {providerConfig.endpointEditable && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  エンドポイント
                </label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) =>
                    updateField("endpoint", e.target.value, setEndpoint)
                  }
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:border-transparent ${
                    fieldErrors.endpoint
                      ? "border-red-400 dark:border-red-600 focus:ring-red-500"
                      : "border-zinc-300 dark:border-zinc-600 focus:ring-indigo-500"
                  }`}
                  placeholder={
                    providerConfig.defaultEndpoint ||
                    "https://api.example.com/v1"
                  }
                />
                {fieldErrors.endpoint && (
                  <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                    {fieldErrors.endpoint}
                  </p>
                )}
                {!fieldErrors.endpoint &&
                  agent.agentType === "azure-openai" && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      例:
                      https://your-resource.openai.azure.com/openai/deployments/your-deployment
                    </p>
                  )}
              </div>
            )}
          </div>
        </div>

        {/* API Key Settings */}
        {providerConfig.requiresApiKey && (
          <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
              <Key className="w-5 h-5" />
              APIキー
            </h2>

            {/* Current API Key Status */}
            <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {agent.hasApiKey ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-600 dark:text-green-400">
                        APIキー設定済み
                      </span>
                      {agent.maskedApiKey && (
                        <code className="text-xs bg-zinc-200 dark:bg-zinc-600 px-2 py-1 rounded">
                          {agent.maskedApiKey}
                        </code>
                      )}
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        APIキー未設定
                      </span>
                    </>
                  )}
                </div>
                {agent.hasApiKey && (
                  <button
                    onClick={handleDeleteApiKey}
                    className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 p-1 rounded"
                    title="APIキーを削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* New API Key Input */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {agent.hasApiKey ? "新しいAPIキー（変更する場合）" : "APIキー"}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) =>
                    updateField("apiKey", e.target.value, setApiKey)
                  }
                  className={`w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:border-transparent ${
                    fieldErrors.apiKey
                      ? "border-red-400 dark:border-red-600 focus:ring-red-500"
                      : "border-zinc-300 dark:border-zinc-600 focus:ring-indigo-500"
                  }`}
                  placeholder={providerConfig.apiKeyPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  {showApiKey ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {fieldErrors.apiKey && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                  {fieldErrors.apiKey}
                </p>
              )}
              {!fieldErrors.apiKey && providerConfig.apiKeyHelpUrl && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  <a
                    href={providerConfig.apiKeyHelpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    APIキーの取得方法
                  </a>
                </p>
              )}
            </div>

            {/* Security Info */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  APIキーはAES-256-GCMで暗号化されてデータベースに保存されます。
                  サーバー側で復号化されてAPIリクエストに使用されます。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Claude Code specific info */}
        {agent.agentType === "claude-code" && (
          <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Claude Code CLI
            </h2>
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  <p className="font-medium mb-1">ローカルCLIモード</p>
                  <p className="text-xs">
                    Claude Codeはローカルにインストールされた
                    <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">
                      claude
                    </code>
                    コマンドを使用します。 APIキーは不要ですが、Claude
                    CLIが正しくインストールされている必要があります。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connection Test */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
            <TestTube2 className="w-5 h-5" />
            接続テスト
          </h2>

          <div className="flex items-center gap-4">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube2 className="w-4 h-4" />
              )}
              接続をテスト
            </button>

            {testResult && (
              <div
                className={`flex items-center gap-2 ${testResult.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                <span className="text-sm">{testResult.message}</span>
              </div>
            )}
          </div>
        </div>


        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            削除
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
