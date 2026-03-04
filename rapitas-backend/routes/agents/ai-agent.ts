/**
 * AI Agent Main Router
 * 機能別ルーターを統合したメインエントリーポイント
 *
 * このファイルは以下の機能別ルーターを統合：
 * - agent-config-router: エージェント設定管理（一覧、デフォルト、トグル、スキーマ）
 * - agent-execution-router: タスク実行機能（実行、停止、応答、継続、リセット）
 * - agent-session-router: セッション管理（セッション詳細、停止、再開可能実行）
 * - agent-audit-router: 監査・ログ機能（監査ログ、実行ログ）
 * - agent-system-router: システム・診断機能（暗号化、診断、シャットダウン、再起動）
 *
 * 以下のルートはこのファイルに残留（将来のリファクタリング対象）：
 * - エージェントCRUD（作成、更新、取得、削除）
 * - APIキー管理
 * - 接続テスト
 * - エージェントタイプ・モデル取得
 * - 開発/レビューエージェント設定
 * - バリデーション
 * - 実行 acknowledge/resume
 * - 実行中タスク一覧
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config";
import { createLogger } from "../../config/logger";

const log = createLogger("routes:ai-agent");
import { toJsonString, fromJsonString } from "../../utils/db-helpers";
import { ParallelExecutor } from "../../services/parallel-execution/parallel-executor";
import type { TaskPriority } from "../../services/parallel-execution/types";
import { orchestrator } from "./approvals";
import {
  encrypt,
  decrypt,
  maskApiKey,
  isEncryptionKeyConfigured,
} from "../../utils/encryption";
import {
  logAgentConfigChange,
  calculateChanges,
} from "../../utils/agent-audit-log";
import { agentFactory } from "../../services/agents/agent-factory";
import { getModelsForAgentType, getAllModels } from "../../utils/agent-models";
import {
  validateApiKeyFormat,
  validateAgentConfig,
} from "../../utils/agent-config-schema";
import {
  cleanImplementationSummary,
  sanitizeScreenshots,
} from "../../utils/agent-response-cleaner";
import { captureScreenshotsForDiff } from "../../services/screenshot-service";
import type { ScreenshotResult } from "../../services/screenshot-service";

// 機能別ルーターのインポート
import { agentConfigRouter } from "./agent-config-router";
import { agentExecutionRouter } from "./agent-execution-router";
import { agentSessionRouter } from "./agent-session-router";
import {
  agentAuditRouter,
  taskExecutionLogsRouter,
} from "./agent-audit-router";
import { agentSystemRouter } from "./agent-system-router";

// Parallel executor instance
let parallelExecutor: ParallelExecutor | null = null;
function getParallelExecutor(): ParallelExecutor {
  if (!parallelExecutor) {
    parallelExecutor = new ParallelExecutor(prisma);
  }
  return parallelExecutor;
}

export const aiAgentRoutes = new Elysia()
  // ============================================================
  // 機能別サブルーターの統合
  // ============================================================
  .use(agentConfigRouter)
  .use(agentExecutionRouter)
  .use(agentSessionRouter)
  .use(agentAuditRouter)
  .use(taskExecutionLogsRouter)
  .use(agentSystemRouter)

  // ============================================================
  // 以下: サブルーター未移行のルート（将来のリファクタリング対象）
  // ============================================================

  // Create agent configuration
  .post(
    "/agents",
    async (context) => {
      const {
        agentType,
        name,
        apiKey,
        endpoint,
        modelId,
        capabilities,
        isDefault,
      } = context.body as {
        agentType: string;
        name: string;
        apiKey?: string;
        endpoint?: string;
        modelId?: string;
        capabilities?: Record<string, unknown>;
        isDefault?: boolean;
      };

      if (isDefault) {
        await prisma.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      // APIキーが提供された場合は暗号化して保存
      let apiKeyEncrypted: string | null = null;
      if (apiKey) {
        if (!isEncryptionKeyConfigured()) {
          log.warn(
            "[agents] Encryption key not configured. API keys should be set via environment variables in production.",
          );
        }
        apiKeyEncrypted = encrypt(apiKey);
      }

      const created = await prisma.aIAgentConfig.create({
        data: {
          agentType,
          name,
          apiKeyEncrypted,
          endpoint,
          modelId,
          capabilities: toJsonString(capabilities || {}) ?? "{}",
          isDefault: isDefault || false,
        },
      });

      // 監査ログを記録
      await logAgentConfigChange({
        agentConfigId: created.id,
        action: "create",
        newValues: {
          agentType,
          name,
          endpoint,
          modelId,
          hasApiKey: !!apiKey,
          isDefault: isDefault || false,
        },
      });

      return created;
    },
    {
      body: t.Object({
        agentType: t.String(),
        name: t.String(),
        apiKey: t.Optional(t.String()),
        endpoint: t.Optional(t.String()),
        modelId: t.Optional(t.String()),
        capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
        isDefault: t.Optional(t.Boolean()),
      }),
    },
  )

  // Update agent configuration
  .patch(
    "/agents/:id",
    async (context) => {
      const { id } = context.params as { id: string };
      const {
        name,
        apiKey,
        clearApiKey,
        endpoint,
        modelId,
        capabilities,
        isDefault,
        isActive,
      } = context.body as {
        name?: string;
        apiKey?: string;
        clearApiKey?: boolean;
        endpoint?: string;
        modelId?: string;
        capabilities?: Record<string, unknown>;
        isDefault?: boolean;
        isActive?: boolean;
      };

      if (isDefault) {
        await prisma.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      // 更新前の値を取得
      const previous = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      // APIキーの処理
      let apiKeyEncrypted: string | null | undefined = undefined;
      if (clearApiKey) {
        apiKeyEncrypted = null;
      } else if (apiKey) {
        if (!isEncryptionKeyConfigured()) {
          log.warn(
            "[agents] Encryption key not configured. API keys should be set via environment variables in production.",
          );
        }
        apiKeyEncrypted = encrypt(apiKey);
      }

      const updated = await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: {
          ...(name && { name }),
          ...(apiKeyEncrypted !== undefined && { apiKeyEncrypted }),
          ...(endpoint !== undefined && { endpoint }),
          ...(modelId !== undefined && { modelId }),
          ...(capabilities && {
            capabilities: toJsonString(capabilities) ?? "{}",
          }),
          ...(isDefault !== undefined && { isDefault }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      // 監査ログを記録
      if (previous) {
        const changes = calculateChanges(
          {
            name: previous.name,
            endpoint: previous.endpoint,
            modelId: previous.modelId,
            isDefault: previous.isDefault,
            isActive: previous.isActive,
            hasApiKey: !!previous.apiKeyEncrypted,
          },
          {
            name: updated.name,
            endpoint: updated.endpoint,
            modelId: updated.modelId,
            isDefault: updated.isDefault,
            isActive: updated.isActive,
            hasApiKey: !!updated.apiKeyEncrypted,
          },
        );

        if (Object.keys(changes).length > 0) {
          await logAgentConfigChange({
            agentConfigId: parseInt(id),
            action: "update",
            changeDetails: changes,
            previousValues: {
              name: previous.name,
              endpoint: previous.endpoint,
              modelId: previous.modelId,
              isDefault: previous.isDefault,
              isActive: previous.isActive,
            },
            newValues: {
              name: updated.name,
              endpoint: updated.endpoint,
              modelId: updated.modelId,
              isDefault: updated.isDefault,
              isActive: updated.isActive,
            },
          });
        }
      }

      return updated;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        clearApiKey: t.Optional(t.Boolean()),
        endpoint: t.Optional(t.String()),
        modelId: t.Optional(t.String()),
        capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
        isDefault: t.Optional(t.Boolean()),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )

  // Get single agent configuration with masked API key
  .get(
    "/agents/:id",
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
        include: {
          _count: { select: { executions: true } },
        },
      });

      if (!agent) {
        set.status = 404;
        return { error: "Agent not found" };
      }

      // APIキーが設定されているかどうかと、マスクされた値を返す
      let maskedApiKey: string | null = null;
      let hasApiKey = false;
      if (agent.apiKeyEncrypted) {
        try {
          const decryptedKey = decrypt(agent.apiKeyEncrypted);
          maskedApiKey = maskApiKey(decryptedKey);
          hasApiKey = true;
        } catch (e) {
          log.error({ err: e }, `[agents] Failed to decrypt API key for agent ${id}`);
          maskedApiKey = "*** (decryption failed)";
          hasApiKey = true;
        }
      }

      return {
        ...agent,
        capabilities: fromJsonString(agent.capabilities) ?? {},
        apiKeyEncrypted: undefined, // 暗号化されたキーは返さない
        maskedApiKey,
        apiKeyMasked: maskedApiKey, // フロントエンド互換のフィールド名
        hasApiKey,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Delete agent configuration
  .delete(
    "/agents/:id",
    async (context) => {
      const { id } = context.params as { id: string };

      // 削除前の値を取得
      const previous = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      const result = await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: { isActive: false },
      });

      // 監査ログを記録
      if (previous) {
        await logAgentConfigChange({
          agentConfigId: parseInt(id),
          action: "delete",
          previousValues: {
            name: previous.name,
            agentType: previous.agentType,
            isActive: previous.isActive,
          },
        });
      }

      return result;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Save API key for agent
  .post(
    "/agents/:id/api-key",
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };
      const { apiKey } = context.body as { apiKey: string };

      if (!apiKey) {
        set.status = 400;
        return { error: "API key is required" };
      }

      if (!isEncryptionKeyConfigured()) {
        log.warn(
          "[agents] Encryption key not configured. API keys should be set via environment variables in production.",
        );
      }

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      if (!agent) {
        set.status = 404;
        return { error: "Agent not found" };
      }

      const apiKeyEncrypted = encrypt(apiKey);

      await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: { apiKeyEncrypted },
      });

      // 監査ログを記録
      await logAgentConfigChange({
        agentConfigId: parseInt(id),
        action: "api_key_set",
        changeDetails: {
          hadApiKeyBefore: !!agent.apiKeyEncrypted,
        },
      });

      return {
        success: true,
        message: "API key saved successfully",
        apiKeyMasked: maskApiKey(apiKey),
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        apiKey: t.String(),
      }),
    },
  )

  // Delete API key for agent
  .delete(
    "/agents/:id/api-key",
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      if (!agent) {
        set.status = 404;
        return { error: "Agent not found" };
      }

      await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: { apiKeyEncrypted: null },
      });

      // 監査ログを記録
      await logAgentConfigChange({
        agentConfigId: parseInt(id),
        action: "api_key_delete",
      });

      return {
        success: true,
        message: "API key deleted successfully",
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Test connection for agent
  .post(
    "/agents/:id/test",
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      if (!agent) {
        set.status = 404;
        return { success: false, message: "Agent not found" };
      }

      try {
        switch (agent.agentType) {
          case "claude-code": {
            const { spawn } = await import("child_process");
            const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

            const result = await new Promise<{
              success: boolean;
              message: string;
            }>((resolve) => {
              const proc = spawn(claudePath, ["--version"], { shell: true });
              let stdout = "";
              let stderr = "";

              const timeout = setTimeout(() => {
                proc.kill();
                resolve({ success: false, message: "Claude CLI timeout" });
              }, 10000);

              proc.stdout?.on("data", (data) => {
                stdout += data.toString();
              });
              proc.stderr?.on("data", (data) => {
                stderr += data.toString();
              });

              proc.on("close", (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                  resolve({
                    success: true,
                    message: `Claude CLI available: ${stdout.trim()}`,
                  });
                } else {
                  resolve({
                    success: false,
                    message: stderr || `Exit code: ${code}`,
                  });
                }
              });

              proc.on("error", (err) => {
                clearTimeout(timeout);
                resolve({
                  success: false,
                  message: `Claude CLI not found: ${err.message}`,
                });
              });
            });
            return result;
          }

          case "anthropic-api": {
            if (!agent.apiKeyEncrypted) {
              return { success: false, message: "APIキーが設定されていません" };
            }

            const apiKey = decrypt(agent.apiKeyEncrypted);
            const response = await fetch(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: agent.modelId || "claude-sonnet-4-20250514",
                  max_tokens: 10,
                  messages: [{ role: "user", content: "Hi" }],
                }),
              },
            );

            if (response.ok) {
              return { success: true, message: "Anthropic API接続成功" };
            } else {
              const errorBody = await response.json().catch(() => ({}));
              const errorMessage =
                errorBody &&
                typeof errorBody === "object" &&
                "error" in errorBody
                  ? (errorBody as { error?: { message?: string } }).error
                      ?.message
                  : undefined;
              return {
                success: false,
                message: `Anthropic API error: ${errorMessage || response.statusText}`,
              };
            }
          }

          case "openai": {
            if (!agent.apiKeyEncrypted) {
              return { success: false, message: "APIキーが設定されていません" };
            }

            const apiKey = decrypt(agent.apiKeyEncrypted);
            const endpoint = agent.endpoint || "https://api.openai.com/v1";

            const response = await fetch(`${endpoint}/models`, {
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            });

            if (response.ok) {
              return { success: true, message: "OpenAI API接続成功" };
            } else {
              const errorBody = await response.json().catch(() => ({}));
              const errorMessage =
                errorBody &&
                typeof errorBody === "object" &&
                "error" in errorBody
                  ? (errorBody as { error?: { message?: string } }).error
                      ?.message
                  : undefined;
              return {
                success: false,
                message: `OpenAI API error: ${errorMessage || response.statusText}`,
              };
            }
          }

          case "azure-openai": {
            if (!agent.apiKeyEncrypted || !agent.endpoint) {
              return {
                success: false,
                message: "APIキーまたはエンドポイントが設定されていません",
              };
            }

            const apiKey = decrypt(agent.apiKeyEncrypted);
            const response = await fetch(
              `${agent.endpoint}?api-version=2024-02-15-preview`,
              {
                headers: {
                  "api-key": apiKey,
                },
              },
            );

            if (response.ok || response.status === 404) {
              return { success: true, message: "Azure OpenAI API接続成功" };
            } else {
              return {
                success: false,
                message: `Azure OpenAI error: ${response.statusText}`,
              };
            }
          }

          case "gemini": {
            if (!agent.apiKeyEncrypted) {
              // Gemini CLIの場合はAPIキーなしでもCLI確認を実施
              const { spawn } = await import("child_process");
              const geminiPath = process.env.GEMINI_CLI_PATH || "gemini";
              const cliResult = await new Promise<{
                success: boolean;
                message: string;
              }>((resolve) => {
                const proc = spawn(geminiPath, ["--version"], { shell: true });
                let stdout = "";
                let stderr = "";
                const timeout = setTimeout(() => {
                  proc.kill();
                  resolve({ success: false, message: "Gemini CLI timeout" });
                }, 10000);
                proc.stdout?.on("data", (data) => {
                  stdout += data.toString();
                });
                proc.stderr?.on("data", (data) => {
                  stderr += data.toString();
                });
                proc.on("close", (code) => {
                  clearTimeout(timeout);
                  if (code === 0) {
                    resolve({
                      success: true,
                      message: `Gemini CLI available: ${stdout.trim()}`,
                    });
                  } else {
                    resolve({
                      success: false,
                      message: stderr || `Exit code: ${code}`,
                    });
                  }
                });
                proc.on("error", (err) => {
                  clearTimeout(timeout);
                  resolve({
                    success: false,
                    message: `Gemini CLI not found: ${err.message}`,
                  });
                });
              });
              return cliResult;
            }

            const apiKey = decrypt(agent.apiKeyEncrypted);
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
            );

            if (response.ok) {
              return { success: true, message: "Gemini API接続成功" };
            } else {
              const errorBody = await response.json().catch(() => ({}));
              const errorMessage =
                errorBody &&
                typeof errorBody === "object" &&
                "error" in errorBody
                  ? (errorBody as { error?: { message?: string } }).error
                      ?.message
                  : undefined;
              return {
                success: false,
                message: `Gemini API error: ${errorMessage || response.statusText}`,
              };
            }
          }

          case "codex": {
            const { spawn } = await import("child_process");
            const codexPath = process.env.CODEX_CLI_PATH || "codex";

            const result = await new Promise<{
              success: boolean;
              message: string;
            }>((resolve) => {
              const proc = spawn(codexPath, ["--version"], { shell: true });
              let stdout = "";
              let stderr = "";

              const timeout = setTimeout(() => {
                proc.kill();
                resolve({ success: false, message: "Codex CLI timeout" });
              }, 10000);

              proc.stdout?.on("data", (data) => {
                stdout += data.toString();
              });
              proc.stderr?.on("data", (data) => {
                stderr += data.toString();
              });

              proc.on("close", (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                  resolve({
                    success: true,
                    message: `Codex CLI available: ${stdout.trim()}`,
                  });
                } else {
                  resolve({
                    success: false,
                    message: stderr || `Exit code: ${code}`,
                  });
                }
              });

              proc.on("error", (err) => {
                clearTimeout(timeout);
                resolve({
                  success: false,
                  message: `Codex CLI not found: ${err.message}`,
                });
              });
            });
            return result;
          }

          default:
            return {
              success: false,
              message: `Unknown agent type: ${agent.agentType}`,
            };
        }
      } catch (error) {
        // 接続テスト失敗時も監査ログを記録
        await logAgentConfigChange({
          agentConfigId: parseInt(id),
          action: "test_connection",
          changeDetails: {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });

        return {
          success: false,
          message: `Connection test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Available agent types
  .get("/agents/types", async () => {
    const registered = agentFactory.getRegisteredAgents();
    const available = await agentFactory.getAvailableAgents();
    return {
      registered,
      available: available.map((a) => a.type),
    };
  })

  // Get available models for a specific agent type
  .get("/agents/models", async (context) => {
    const { query } = context;
    if (query.type) {
      const models = await getModelsForAgentType(query.type);
      return { models };
    }

    // Return all models grouped by agent type
    const allModels = await getAllModels();
    return allModels;
  })

  // Set development agent configuration
  .post(
    "/agents/development",
    async (context) => {
      const { type, model } = context.body as { type: string; model: string };

      // Find or create agent config
      let agent = await prisma.aIAgentConfig.findFirst({
        where: {
          agentType: type,
          isActive: true,
        },
      });

      if (!agent) {
        // Create new agent config
        agent = await prisma.aIAgentConfig.create({
          data: {
            agentType: type,
            name: `Development Agent (${type})`,
            modelId: model,
            isActive: true,
            isDefault: false,
            capabilities: JSON.stringify({
              codeGeneration: true,
              taskAnalysis: true,
              fileOperations: true,
              terminalAccess: true,
              gitOperations: true,
            }),
          },
        });
      } else {
        // Update existing agent
        agent = await prisma.aIAgentConfig.update({
          where: { id: agent.id },
          data: {
            modelId: model,
            name: `Development Agent (${type})`,
          },
        });
      }

      // Set as default agent for development tasks
      await prisma.aIAgentConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });

      await prisma.aIAgentConfig.update({
        where: { id: agent.id },
        data: { isDefault: true },
      });

      return { success: true, agent };
    },
    {
      body: t.Object({
        type: t.String(),
        model: t.String(),
      }),
    },
  )

  // Set review agent configuration
  .post(
    "/agents/review",
    async (context) => {
      const body = context.body as { type: string; model: string };
      const { type, model } = body;

      // Find or create agent config for review
      let agent = await prisma.aIAgentConfig.findFirst({
        where: {
          agentType: type,
          name: { contains: "Review" },
          isActive: true,
        },
      });

      if (!agent) {
        // Create new agent config
        agent = await prisma.aIAgentConfig.create({
          data: {
            agentType: type,
            name: `Review Agent (${type})`,
            modelId: model,
            isActive: true,
            isDefault: false,
            capabilities: JSON.stringify({
              codeReview: true,
              taskAnalysis: true,
              fileOperations: true,
              webSearch: true,
            }),
          },
        });
      } else {
        // Update existing agent
        agent = await prisma.aIAgentConfig.update({
          where: { id: agent.id },
          data: {
            modelId: model,
          },
        });
      }

      return { success: true, agent };
    },
    {
      body: t.Object({
        type: t.String(),
        model: t.String(),
      }),
    },
  )

  // Validate agent configuration
  .post("/agents/validate-config", async ({ body, set }) => {
    const { agentType, apiKey, endpoint, modelId, additionalConfig } =
      body as {
        agentType: string;
        apiKey?: string;
        endpoint?: string;
        modelId?: string;
        additionalConfig?: Record<string, unknown>;
      };

    const errors: string[] = [];

    // APIキーのバリデーション
    if (apiKey) {
      const apiKeyResult = validateApiKeyFormat(agentType, apiKey);
      if (!apiKeyResult.valid && apiKeyResult.message) {
        errors.push(apiKeyResult.message);
      }
    }

    // 設定のバリデーション
    const configResult = validateAgentConfig(agentType, {
      endpoint,
      modelId,
      additionalConfig,
    });

    if (!configResult.valid) {
      errors.push(...configResult.errors);
    }

    if (errors.length > 0) {
      set.status = 400;
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  })

  // Test API key connection for an agent
  .post("/agents/:id/test-connection", async (context) => {
    const { id } = context.params as { id: string };
    const agent = await prisma.aIAgentConfig.findUnique({
      where: { id: parseInt(id) },
    });

    if (!agent) {
      context.set.status = 404;
      return { success: false, error: "Agent not found" };
    }

    // エージェントタイプに応じた接続テスト
    try {
      if (agent.agentType === "claude-code") {
        // Claude Code CLIは--versionで動作確認
        const { spawn } = await import("child_process");
        const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

        const testResult = await new Promise<{
          success: boolean;
          output?: string;
          error?: string;
        }>((resolve) => {
          const proc = spawn(claudePath, ["--version"], { shell: true });
          let stdout = "";
          let stderr = "";

          const timeout = setTimeout(() => {
            proc.kill();
            resolve({ success: false, error: "Timeout (10s)" });
          }, 10000);

          proc.stdout?.on("data", (data) => {
            stdout += data.toString();
          });
          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });

          proc.on("close", (code) => {
            clearTimeout(timeout);
            resolve({
              success: code === 0,
              output: stdout.trim(),
              error:
                stderr.trim() ||
                (code !== 0 ? `Exit code: ${code}` : undefined),
            });
          });

          proc.on("error", (err) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err.message });
          });
        });

        return {
          success: testResult.success,
          agentType: agent.agentType,
          message: testResult.success
            ? `Claude Code CLI接続成功: ${testResult.output}`
            : `Claude Code CLI接続失敗: ${testResult.error}`,
          details: testResult,
        };
      }

      // APIキーを使用するエージェントタイプの場合
      if (!agent.apiKeyEncrypted) {
        return {
          success: false,
          agentType: agent.agentType,
          message: "APIキーが設定されていません",
        };
      }

      // 将来のプロバイダー用のプレースホルダー
      return {
        success: true,
        agentType: agent.agentType,
        message: `${agent.agentType}の接続テストはまだ実装されていません`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        agentType: agent.agentType,
        error: errorMsg,
        message: `接続テストに失敗しました: ${errorMsg}`,
      };
    }
  })

  // Mark interrupted execution as acknowledged (to clear it from the list)
  .post("/agents/executions/:id/acknowledge", async (context) => {
    const { params } = context;
    const executionId = parseInt(params.id);

    const execution = await prisma.agentExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return { success: false, error: "Execution not found" };
    }

    if (execution.status !== "interrupted") {
      return { success: false, error: "Execution is not interrupted" };
    }

    // ステータスを「確認済み」として更新
    await prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: "acknowledged",
        completedAt: new Date(),
      },
    });

    return { success: true, message: "Execution acknowledged" };
  })

  // Resume interrupted execution
  .post("/agents/executions/:id/resume", async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { timeout?: number } | undefined;
    const executionId = parseInt(params.id);

    try {
      // 中断された実行を取得して情報を確認
      const execution = await prisma.agentExecution.findUnique({
        where: { id: executionId },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                      description: true,
                      theme: {
                        select: {
                          workingDirectory: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!execution) {
        return { success: false, error: "Execution not found" };
      }

      if (execution.status !== "interrupted") {
        return {
          success: false,
          error: `Cannot resume execution with status: ${execution.status}`,
        };
      }

      const task = execution.session.config?.task;
      if (!task) {
        return { success: false, error: "Task not found for this execution" };
      }

      const workingDirectory = task.theme?.workingDirectory || process.cwd();

      // サブタスクの存在を確認（進行中のサブタスクのみ）
      const subtasks = await prisma.task.findMany({
        where: {
          parentId: task.id,
          status: "in-progress", // 進行中のサブタスクのみ
        },
        orderBy: { id: "asc" },
      });

      const hasSubtasks = subtasks.length > 0;
      log.info(
        `[resume] Task ${task.id} has ${subtasks.length} in-progress subtasks`,
      );

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "agent_execution_resumed",
          title: "エージェント実行再開",
          message: `「${task.title}」の中断された作業を再開しています${hasSubtasks ? `（進行中のサブタスク${subtasks.length}件を並列実行）` : ""}`,
          link: `/tasks/${task.id}`,
          metadata: toJsonString({
            executionId,
            sessionId: execution.sessionId,
            taskId: task.id,
            parallelExecution: hasSubtasks,
          }),
        },
      });

      // 進行中のサブタスクがある場合は並列実行
      if (hasSubtasks) {
        log.info(
          `[resume] Starting parallel execution for task ${task.id} with ${subtasks.length} in-progress subtasks`,
        );

        // 並列実行を開始
        const executor = getParallelExecutor();

        // サブタスクの依存関係を分析
        const analysisResult = await executor.analyzeDependencies({
          parentTaskId: task.id,
          subtasks: subtasks.map((st: (typeof subtasks)[number]) => ({
            id: st.id,
            title: st.title,
            description: st.description || "",
            estimatedHours: st.estimatedHours || 1,
            priority: (st.priority || "medium") as TaskPriority,
            explicitDependencies: [] as number[],
          })),
        });

        // 非同期で並列実行を開始
        executor
          .startSession(
            task.id,
            analysisResult.plan,
            analysisResult.treeMap.nodes,
            workingDirectory,
          )
          .then(async (session) => {
            log.info(
              `[resume] Parallel execution session started: ${session.sessionId}`,
            );
          })
          .catch(async (error) => {
            log.error({ err: error }, "[resume] Parallel execution error");
            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "並列実行エラー",
                message: `「${task.title}」の並列実行中にエラーが発生しました: ${error.message}`,
                link: `/tasks/${task.id}`,
              },
            });
          });

        return {
          success: true,
          executionId,
          taskId: task.id,
          taskTitle: task.title,
          parallelExecution: true,
          subtaskCount: subtasks.length,
          message: `進行中のサブタスク${subtasks.length}件の並列実行を再開しました。進捗はリアルタイムで確認できます。`,
        };
      }

      // タスクのステータスを in-progress に更新
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: "in-progress",
          startedAt: new Date(),
        },
      });
      log.info(`[resume] Updated task ${task.id} status to 'in-progress'`);

      // サブタスクがない場合は通常の再開
      orchestrator
        .resumeInterruptedExecution(executionId, {
          timeout: body?.timeout || 900000,
        })
        .then(async (result) => {
          if (result.success && !result.waitingForInput) {
            // ワークフローステータスに基づいてタスクステータスを決定
            const currentTask = await prisma.task.findUnique({
              where: { id: task.id },
            });
            const wfStatus = currentTask?.workflowStatus;
            if (
              wfStatus &&
              ["plan_created", "research_done", "verify_done"].includes(
                wfStatus,
              )
            ) {
              await prisma.task.update({
                where: { id: task.id },
                data: { status: "in-progress" },
              });
              log.info(
                `[resume] Task ${task.id} kept as in-progress (workflow: ${wfStatus})`,
              );
            } else if (
              wfStatus === "in_progress" ||
              wfStatus === "plan_approved"
            ) {
              log.info(
                `[resume] Task ${task.id} kept as in-progress (workflow: ${wfStatus})`,
              );
            } else if (wfStatus === "completed") {
              await prisma.task.update({
                where: { id: task.id },
                data: { status: "done", completedAt: new Date() },
              });
              log.info(
                `[resume] Updated task ${task.id} status to 'done'`,
              );
            } else if (!wfStatus || wfStatus === "draft") {
              await prisma.task.update({
                where: { id: task.id },
                data: { status: "done", completedAt: new Date() },
              });
              log.info(
                `[resume] Updated task ${task.id} status to 'done'`,
              );
            } else {
              log.info(
                `[resume] Task ${task.id} kept as in-progress (unknown workflow: ${wfStatus})`,
              );
            }

            // セッションのステータスも完了に更新
            await prisma.agentSession
              .update({
                where: { id: execution.sessionId },
                data: {
                  status: "completed",
                  completedAt: new Date(),
                },
              })
              .catch(() => {});

            const diff = await orchestrator.getFullGitDiff(workingDirectory);
            if (diff && diff !== "No changes detected") {
              const structuredDiff =
                await orchestrator.getDiff(workingDirectory);
              const implementationSummary = cleanImplementationSummary(
                result.output || "再開した作業が完了しました。",
              );

              // UI変更がある場合はスクリーンショットを撮影
              let screenshots: ScreenshotResult[] = [];
              try {
                screenshots = await captureScreenshotsForDiff(structuredDiff, {
                  workingDirectory,
                  agentOutput: result.output || "",
                });
                if (screenshots.length > 0) {
                  log.info(
                    `[agent-resume] Captured ${screenshots.length} screenshots for task ${task.id}: ${screenshots.map((s) => s.page).join(", ")}`,
                  );
                }
              } catch (screenshotErr) {
                log.warn({ err: screenshotErr }, "[agent-resume] Screenshot capture failed (non-fatal)");
              }

              const screenshotData = sanitizeScreenshots(screenshots);
              const config = execution.session.config;
              if (config) {
                log.info(
                  `[agent-resume] Creating approval with ${screenshotData.length} screenshot(s): ${screenshotData.map((s) => s.url).join(", ")}`,
                );
                const approvalRequest = await prisma.approvalRequest.create({
                  data: {
                    configId: config.id,
                    requestType: "code_review",
                    title: `「${task.title}」のコードレビュー（再開後）`,
                    description: implementationSummary,
                    proposedChanges: toJsonString({
                      taskId: task.id,
                      sessionId: execution.sessionId,
                      workingDirectory,
                      structuredDiff,
                      implementationSummary,
                      executionTimeMs: result.executionTimeMs,
                      resumed: true,
                      screenshots: screenshotData,
                    }),
                    executionType: "code_review",
                    estimatedChanges: toJsonString({
                      filesChanged: structuredDiff.length,
                      summary: implementationSummary.substring(0, 500),
                    }),
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                  },
                });

                await prisma.notification.create({
                  data: {
                    type: "pr_review_requested",
                    title: "コードレビュー依頼（再開後）",
                    message: `「${task.title}」の再開した作業が完了しました。レビューをお願いします。`,
                    link: `/approvals/${approvalRequest.id}`,
                  },
                });
              }
            } else {
              await prisma.notification.create({
                data: {
                  type: "agent_execution_complete",
                  title: "エージェント実行完了（変更なし）",
                  message: `「${task.title}」の再開した作業が完了しましたが、コード変更はありませんでした。`,
                  link: `/tasks/${task.id}`,
                },
              });
            }
          } else if (result.waitingForInput) {
            log.info(
              `[resume] Task ${task.id} is waiting for input after resume`,
            );
          } else {
            // 失敗の場合はタスクステータスを todo に戻す
            await prisma.task.update({
              where: { id: task.id },
              data: { status: "todo" },
            });
            log.info(
              `[resume] Reverted task ${task.id} status to 'todo' due to failure`,
            );

            await prisma.agentSession
              .update({
                where: { id: execution.sessionId },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage:
                    result.errorMessage || "Execution failed after resume",
                },
              })
              .catch(() => {});

            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "再開した実行が失敗",
                message: `「${task.title}」の再開した作業が失敗しました: ${result.errorMessage}`,
                link: `/tasks/${task.id}`,
              },
            });
          }
        })
        .catch(async (error) => {
          log.error({ err: error }, "[resume] Resume execution error");

          await prisma.task
            .update({
              where: { id: task.id },
              data: { status: "todo" },
            })
            .catch(() => {});
          log.info(
            `[resume] Reverted task ${task.id} status to 'todo' due to error`,
          );

          await prisma.agentSession
            .update({
              where: { id: execution.sessionId },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: error.message || "Resume execution error",
              },
            })
            .catch(() => {});

          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "実行再開エラー",
              message: `「${task.title}」の再開中にエラーが発生しました: ${error.message}`,
              link: `/tasks/${task.id}`,
            },
          });
        });

      return {
        success: true,
        executionId,
        taskId: task.id,
        taskTitle: task.title,
        message:
          "中断された実行を再開しています。進捗はリアルタイムで確認できます。",
      };
    } catch (error) {
      log.error({ err: error }, "[resume] Error");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to resume execution",
      };
    }
  })

  // Get all currently executing tasks (for real-time panel display)
  .get("/tasks/executing", async () => {
    try {
      const executingTasks = await prisma.agentExecution.findMany({
        where: {
          status: {
            in: ["running", "waiting_for_input"],
          },
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          session: {
            select: {
              id: true,
              config: {
                select: {
                  taskId: true,
                },
              },
            },
          },
        },
        orderBy: { startedAt: "desc" },
      });

      return executingTasks.map(
        (execution: (typeof executingTasks)[number]) => ({
          executionId: execution.id,
          sessionId: execution.session.id,
          taskId: execution.session.config.taskId,
          executionStatus: execution.status,
          startedAt: execution.startedAt,
        }),
      );
    } catch (error) {
      const errObj = error as { code?: string; message?: string };
      if (errObj?.code === "P1001") {
        log.warn("[executing-tasks] Database unreachable, skipping");
      } else {
        log.error({ err: error },
          "[executing-tasks] Error",
        );
      }
      return [];
    }
  });
