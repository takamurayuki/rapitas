/**
 * AI Agent API Routes
 * Agent configuration, task execution, and session management
 */
import { Elysia } from "elysia";
import { join } from "path";
import { prisma } from "../config/database";
import { agentFactory } from "../services/agents/agent-factory";
import { orchestrator } from "./approvals";
import { toJsonString, fromJsonString } from "../utils/db-helpers";
import { ParallelExecutor } from "../services/parallel-execution/parallel-executor";
import { encrypt, decrypt, maskApiKey, isEncryptionKeyConfigured } from "../utils/encryption";
import {
  getAgentConfigSchema,
  getAllAgentConfigSchemas,
  validateApiKeyFormat,
  validateAgentConfig,
} from "../utils/agent-config-schema";
import {
  logAgentConfigChange,
  calculateChanges,
  getAgentConfigAuditLogs,
  getRecentAuditLogs,
} from "../utils/agent-audit-log";

// Parallel executor instance
let parallelExecutor: ParallelExecutor | null = null;
function getParallelExecutor(): ParallelExecutor {
  if (!parallelExecutor) {
    parallelExecutor = new ParallelExecutor(prisma);
  }
  return parallelExecutor;
}

// Upload directory for attachments
const UPLOAD_DIR = join(process.cwd(), "uploads");

export const aiAgentRoutes = new Elysia()
  // Agent configuration list
  .get("/agents", async () => {
    return await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  // Create agent configuration
  .post(
    "/agents",
    async ({
      body,
    }: {
      body: {
        agentType: string;
        name: string;
        apiKey?: string;
        endpoint?: string;
        modelId?: string;
        capabilities?: any;
        isDefault?: boolean;
      };
    }) => {
      const { agentType, name, apiKey, endpoint, modelId, capabilities, isDefault } =
        body;

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
          console.warn("[agents] Encryption key not configured. API keys should be set via environment variables in production.");
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
          capabilities: capabilities || {},
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
  )

  // Update agent configuration
  .patch(
    "/agents/:id",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: {
        name?: string;
        apiKey?: string;
        clearApiKey?: boolean;
        endpoint?: string;
        modelId?: string;
        capabilities?: any;
        isDefault?: boolean;
        isActive?: boolean;
      };
    }) => {
      const { id } = params;
      const { name, apiKey, clearApiKey, endpoint, modelId, capabilities, isDefault, isActive } =
        body;

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
          console.warn("[agents] Encryption key not configured. API keys should be set via environment variables in production.");
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
          ...(capabilities && { capabilities }),
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
          }
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
  )

  // Get single agent configuration with masked API key
  .get("/agents/:id", async ({ params, set }: { params: { id: string }; set: any }) => {
    const { id } = params;
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
        console.error(`[agents] Failed to decrypt API key for agent ${id}:`, e);
        maskedApiKey = "*** (decryption failed)";
        hasApiKey = true;
      }
    }

    return {
      ...agent,
      apiKeyEncrypted: undefined, // 暗号化されたキーは返さない
      maskedApiKey,
      apiKeyMasked: maskedApiKey, // フロントエンド互換のフィールド名
      hasApiKey,
    };
  })

  // Delete agent configuration
  .delete("/agents/:id", async ({ params }: { params: { id: string } }) => {
    const { id } = params;

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
  })

  // Save API key for agent
  .post(
    "/agents/:id/api-key",
    async ({
      params,
      body,
      set,
    }: {
      params: { id: string };
      body: { apiKey: string };
      set: any;
    }) => {
      const { id } = params;
      const { apiKey } = body;

      if (!apiKey) {
        set.status = 400;
        return { error: "API key is required" };
      }

      if (!isEncryptionKeyConfigured()) {
        console.warn(
          "[agents] Encryption key not configured. API keys should be set via environment variables in production."
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
    }
  )

  // Delete API key for agent
  .delete(
    "/agents/:id/api-key",
    async ({ params, set }: { params: { id: string }; set: any }) => {
      const { id } = params;

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
    }
  )

  // Test connection for agent (alias for test-connection)
  .post(
    "/agents/:id/test",
    async ({ params, set }: { params: { id: string }; set: any }) => {
      const { id } = params;
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

            const result = await new Promise<{ success: boolean; message: string }>(
              (resolve) => {
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
              }
            );
            return result;
          }

          case "anthropic-api": {
            if (!agent.apiKeyEncrypted) {
              return { success: false, message: "APIキーが設定されていません" };
            }

            const apiKey = decrypt(agent.apiKeyEncrypted);
            const response = await fetch("https://api.anthropic.com/v1/messages", {
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
            });

            if (response.ok) {
              return { success: true, message: "Anthropic API接続成功" };
            } else {
              const error = await response.json().catch(() => ({}));
              return {
                success: false,
                message: `Anthropic API error: ${(error as any).error?.message || response.statusText}`,
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
              const error = await response.json().catch(() => ({}));
              return {
                success: false,
                message: `OpenAI API error: ${(error as any).error?.message || response.statusText}`,
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
              }
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
              const cliResult = await new Promise<{ success: boolean; message: string }>(
                (resolve) => {
                  const proc = spawn(geminiPath, ["--version"], { shell: true });
                  let stdout = "";
                  let stderr = "";
                  const timeout = setTimeout(() => {
                    proc.kill();
                    resolve({ success: false, message: "Gemini CLI timeout" });
                  }, 10000);
                  proc.stdout?.on("data", (data) => { stdout += data.toString(); });
                  proc.stderr?.on("data", (data) => { stderr += data.toString(); });
                  proc.on("close", (code) => {
                    clearTimeout(timeout);
                    if (code === 0) {
                      resolve({ success: true, message: `Gemini CLI available: ${stdout.trim()}` });
                    } else {
                      resolve({ success: false, message: stderr || `Exit code: ${code}` });
                    }
                  });
                  proc.on("error", (err) => {
                    clearTimeout(timeout);
                    resolve({ success: false, message: `Gemini CLI not found: ${err.message}` });
                  });
                }
              );
              return cliResult;
            }

            const apiKey = decrypt(agent.apiKeyEncrypted);
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
            );

            if (response.ok) {
              return { success: true, message: "Gemini API接続成功" };
            } else {
              const error = await response.json().catch(() => ({}));
              return {
                success: false,
                message: `Gemini API error: ${(error as any).error?.message || response.statusText}`,
              };
            }
          }

          case "codex": {
            const { spawn } = await import("child_process");
            const codexPath = process.env.CODEX_CLI_PATH || "codex";

            const result = await new Promise<{ success: boolean; message: string }>(
              (resolve) => {
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
              }
            );
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
    }
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

  // Get encryption configuration status
  .get("/agents/encryption-status", async () => {
    return {
      isConfigured: isEncryptionKeyConfigured(),
      message: isEncryptionKeyConfigured()
        ? "暗号化キーが正しく設定されています"
        : "警告: 暗号化キーが環境変数に設定されていません。本番環境では必ず設定してください。",
    };
  })

  // Get all agent configuration schemas
  .get("/agents/config-schemas", async () => {
    return {
      schemas: getAllAgentConfigSchemas(),
    };
  })

  // Get configuration schema for a specific agent type
  .get("/agents/config-schema/:agentType", async ({ params, set }: { params: { agentType: string }; set: any }) => {
    const { agentType } = params;
    const schema = getAgentConfigSchema(agentType);

    if (!schema) {
      set.status = 404;
      return { error: `Unknown agent type: ${agentType}` };
    }

    return { schema };
  })

  // Validate agent configuration
  .post(
    "/agents/validate-config",
    async ({
      body,
      set,
    }: {
      body: {
        agentType: string;
        apiKey?: string;
        endpoint?: string;
        modelId?: string;
        additionalConfig?: Record<string, unknown>;
      };
      set: any;
    }) => {
      const { agentType, apiKey, endpoint, modelId, additionalConfig } = body;

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
    }
  )

  // Get audit logs for a specific agent
  .get(
    "/agents/:id/audit-logs",
    async ({ params, query }: { params: { id: string }; query: { limit?: string } }) => {
      const { id } = params;
      const limit = query.limit ? parseInt(query.limit) : 50;

      const logs = await getAgentConfigAuditLogs(parseInt(id), limit);
      return { logs };
    }
  )

  // Get recent audit logs (all agents)
  .get(
    "/agents/audit-logs/recent",
    async ({ query }: { query: { limit?: string } }) => {
      const limit = query.limit ? parseInt(query.limit) : 100;
      const logs = await getRecentAuditLogs(limit);
      return { logs };
    }
  )

  // Test API key connection for an agent
  .post(
    "/agents/:id/test-connection",
    async ({ params, set }: { params: { id: string }; set: any }) => {
      const { id } = params;
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      if (!agent) {
        set.status = 404;
        return { success: false, error: "Agent not found" };
      }

      // エージェントタイプに応じた接続テスト
      try {
        if (agent.agentType === "claude-code") {
          // Claude Code CLIは--versionで動作確認
          const { spawn } = await import("child_process");
          const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

          const testResult = await new Promise<{ success: boolean; output?: string; error?: string }>((resolve) => {
            const proc = spawn(claudePath, ["--version"], { shell: true });
            let stdout = "";
            let stderr = "";

            const timeout = setTimeout(() => {
              proc.kill();
              resolve({ success: false, error: "Timeout (10s)" });
            }, 10000);

            proc.stdout?.on("data", (data) => { stdout += data.toString(); });
            proc.stderr?.on("data", (data) => { stderr += data.toString(); });

            proc.on("close", (code) => {
              clearTimeout(timeout);
              resolve({
                success: code === 0,
                output: stdout.trim(),
                error: stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
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
        // TODO: OpenAI, Gemini等の接続テスト実装
        return {
          success: true,
          agentType: agent.agentType,
          message: `${agent.agentType}の接続テストはまだ実装されていません`,
        };
      } catch (error: any) {
        return {
          success: false,
          agentType: agent.agentType,
          error: error.message || "Unknown error",
          message: `接続テストに失敗しました: ${error.message}`,
        };
      }
    },
  )

  // Execute agent on task
  .post(
    "/tasks/:id/execute",
    async ({
      params,
      body,
      set,
    }: {
      params: { id: string };
      body: {
        agentConfigId?: number;
        workingDirectory?: string;
        timeout?: number;
        instruction?: string;
        branchName?: string;
        useTaskAnalysis?: boolean;
        optimizedPrompt?: string;
        attachments?: Array<{
          id: number;
          title: string;
          type: string;
          fileName?: string;
          filePath?: string;
          mimeType?: string;
          description?: string;
        }>;
      };
      set: any;
    }) => {
      const { id } = params;
      const taskIdNum = parseInt(id);
      const {
        agentConfigId,
        workingDirectory,
        timeout,
        instruction,
        branchName,
        useTaskAnalysis,
        optimizedPrompt,
        attachments,
      } = body;

      const task = await prisma.task.findUnique({
        where: { id: taskIdNum },
        include: {
          developerModeConfig: true,
          theme: true,
        },
      });

      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }

      const workDir =
        workingDirectory || task.theme?.workingDirectory || process.cwd();

      if (!task.theme?.isDevelopment && !workingDirectory) {
        console.warn(
          `Task ${taskIdNum} is not in a development theme. Using current directory.`,
        );
      }

      let developerModeConfig = task.developerModeConfig;
      if (!developerModeConfig) {
        developerModeConfig = await prisma.developerModeConfig.create({
          data: {
            taskId: taskIdNum,
            isEnabled: true,
          },
        });
      }

      const session = await prisma.agentSession.create({
        data: {
          configId: developerModeConfig.id,
          status: "pending",
        },
      });

      if (branchName) {
        const branchCreated = await orchestrator.createBranch(
          workDir,
          branchName,
        );
        if (!branchCreated) {
          return { error: "Failed to create branch", branchName };
        }
      }

      await prisma.notification.create({
        data: {
          type: "agent_execution_started",
          title: "エージェント実行開始",
          message: `「${task.title}」の自動実行を開始しました`,
          link: `/tasks/${taskIdNum}`,
          metadata: toJsonString({ sessionId: session.id, taskId: taskIdNum }),
        },
      });

      // タスクのステータスを「進行中」に更新
      await prisma.task.update({
        where: { id: taskIdNum },
        data: {
          status: "in-progress",
          startedAt: task.startedAt || new Date(),
        },
      });
      console.log(`[API] Updated task ${taskIdNum} status to 'in-progress'`);

      let fullInstruction: string;
      if (optimizedPrompt) {
        fullInstruction = instruction
          ? `${optimizedPrompt}\n\n追加指示:\n${instruction}`
          : optimizedPrompt;
        console.log(`[API] Using optimized prompt for task ${taskIdNum}`);
      } else {
        fullInstruction = instruction
          ? `${task.description || task.title}\n\n追加指示:\n${instruction}`
          : task.description || task.title;
      }

      // 添付ファイル情報を指示に追加
      if (attachments && attachments.length > 0) {
        const attachmentInfo = attachments
          .map((a) => {
            let info = `- ${a.title} (${a.type})`;
            if (a.fileName) info += ` - ファイル名: ${a.fileName}`;
            if (a.description) info += ` - 説明: ${a.description}`;
            if (a.filePath) {
              const fullPath = join(UPLOAD_DIR, a.filePath);
              info += `\n  パス: ${fullPath}`;
            }
            return info;
          })
          .join("\n");
        fullInstruction += `\n\n## 添付ファイル\n以下のファイルがタスクに添付されています。必要に応じて参照してください:\n${attachmentInfo}`;
        console.log(
          `[API] Added ${attachments.length} attachments to instruction`,
        );
      }

      let analysisInfo:
        | {
            summary: string;
            complexity: "simple" | "medium" | "complex";
            estimatedTotalHours: number;
            subtasks: Array<{
              title: string;
              description: string;
              estimatedHours: number;
              priority: "low" | "medium" | "high" | "urgent";
              order: number;
              dependencies?: number[];
            }>;
            reasoning: string;
            tips?: string[];
          }
        | undefined;

      if (useTaskAnalysis && developerModeConfig) {
        const latestAnalysisAction = await prisma.agentAction.findFirst({
          where: {
            session: {
              configId: developerModeConfig.id,
            },
            actionType: "analysis",
            status: "success",
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        if (latestAnalysisAction?.output) {
          try {
            const analysisOutput = fromJsonString<any>(
              latestAnalysisAction.output,
            );
            if (analysisOutput?.summary && analysisOutput?.suggestedSubtasks) {
              analysisInfo = {
                summary: analysisOutput.summary,
                complexity: analysisOutput.complexity || "medium",
                estimatedTotalHours: analysisOutput.estimatedTotalHours || 0,
                subtasks: (analysisOutput.suggestedSubtasks || []).map(
                  (st: any) => ({
                    title: st.title,
                    description: st.description || "",
                    estimatedHours: st.estimatedHours || 0,
                    priority: st.priority || "medium",
                    order: st.order || 0,
                    dependencies: st.dependencies,
                  }),
                ),
                reasoning: analysisOutput.reasoning || "",
                tips: analysisOutput.tips,
              };
              console.log(`[API] Using AI task analysis for task ${taskIdNum}`);
              console.log(
                `[API] Analysis subtasks count: ${analysisInfo.subtasks.length}`,
              );
            }
          } catch (e) {
            console.error(`[API] Failed to parse analysis result:`, e);
          }
        } else {
          console.log(`[API] No analysis result found for task ${taskIdNum}`);
        }
      }

      // Execute Claude Code asynchronously
      orchestrator
        .executeTask(
          {
            id: taskIdNum,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory: workDir,
          },
          {
            taskId: taskIdNum,
            sessionId: session.id,
            agentConfigId,
            workingDirectory: workDir,
            timeout,
            analysisInfo,
          },
        )
        .then(async (result) => {
          if (result.success) {
            // タスクのステータスを「完了」に更新
            await prisma.task.update({
              where: { id: taskIdNum },
              data: {
                status: "done",
                completedAt: new Date(),
              },
            });
            console.log(`[API] Updated task ${taskIdNum} status to 'done'`);

            const diff = await orchestrator.getFullGitDiff(workDir);
            const structuredDiff = await orchestrator.getDiff(workDir);

            if (diff && diff !== "No changes detected") {
              const implementationSummary =
                result.output || "実装が完了しました。";

              const approvalRequest = await prisma.approvalRequest.create({
                data: {
                  configId: developerModeConfig!.id,
                  requestType: "code_review",
                  title: `「${task.title}」のコードレビュー`,
                  description: implementationSummary,
                  proposedChanges: toJsonString({
                    taskId: taskIdNum,
                    sessionId: session.id,
                    workingDirectory: workDir,
                    branchName,
                    diff,
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: result.executionTimeMs,
                  }),
                  executionType: "code_review",
                  estimatedChanges: toJsonString({
                    diff,
                    filesChanged: structuredDiff.length,
                    summary: implementationSummary.substring(0, 500),
                  }),
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
              });

              await prisma.notification.create({
                data: {
                  type: "pr_review_requested",
                  title: "コードレビュー依頼",
                  message: `「${task.title}」の実装が完了しました。レビューをお願いします。`,
                  link: `/approvals/${approvalRequest.id}`,
                  metadata: toJsonString({
                    approvalRequestId: approvalRequest.id,
                    sessionId: session.id,
                    taskId: taskIdNum,
                  }),
                },
              });
            } else {
              await prisma.notification.create({
                data: {
                  type: "agent_execution_complete",
                  title: "エージェント実行完了（変更なし）",
                  message: `「${task.title}」の実行が完了しましたが、コード変更はありませんでした。`,
                  link: `/tasks/${taskIdNum}`,
                  metadata: toJsonString({
                    sessionId: session.id,
                    taskId: taskIdNum,
                  }),
                },
              });
            }
          } else {
            // タスクのステータスを「未着手」に戻す
            await prisma.task.update({
              where: { id: taskIdNum },
              data: {
                status: "todo",
              },
            });
            console.log(`[API] Reverted task ${taskIdNum} status to 'todo' due to failure`);

            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "エージェント実行失敗",
                message: `「${task.title}」の自動実行が失敗しました: ${result.errorMessage}`,
                link: `/tasks/${taskIdNum}`,
                metadata: toJsonString({
                  sessionId: session.id,
                  taskId: taskIdNum,
                }),
              },
            });
          }
        })
        .catch(async (error) => {
          console.error("Agent execution error:", error);

          // エラー時もタスクのステータスを「未着手」に戻す
          await prisma.task.update({
            where: { id: taskIdNum },
            data: {
              status: "todo",
            },
          }).catch(() => {});
          console.log(`[API] Reverted task ${taskIdNum} status to 'todo' due to error`);

          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "エージェント実行エラー",
              message: `「${task.title}」の実行中にエラーが発生しました`,
              link: `/tasks/${taskIdNum}`,
            },
          });
        });

      return {
        success: true,
        sessionId: session.id,
        taskId: taskIdNum,
        workingDirectory: workDir,
        message:
          "エージェント実行を開始しました。リアルタイムで進捗を確認できます。",
      };
    },
  )

  // Claude CLI diagnosis endpoint
  .get("/agents/diagnose", async () => {
    const { spawn } = await import("child_process");
    const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

    console.log("[Diagnose] Testing Claude CLI...");
    console.log("[Diagnose] Claude path:", claudePath);
    console.log("[Diagnose] Platform:", process.platform);

    const results: {
      step: string;
      success: boolean;
      output?: string;
      error?: string;
      duration?: number;
    }[] = [];

    // Step 1: Test claude --version
    const versionResult = await new Promise<{
      success: boolean;
      output?: string;
      error?: string;
      duration: number;
    }>((resolve) => {
      const startTime = Date.now();
      const proc = spawn(claudePath, ["--version"], { shell: true });
      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          error: "Timeout (10s)",
          duration: Date.now() - startTime,
        });
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
            stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
          duration: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: err.message,
          duration: Date.now() - startTime,
        });
      });
    });

    results.push({ step: "claude --version", ...versionResult });
    console.log("[Diagnose] Version check:", versionResult);

    // Step 2: Test simple prompt with spawn and explicit cmd.exe
    if (versionResult.success) {
      const promptResult = await new Promise<{
        success: boolean;
        output?: string;
        error?: string;
        duration: number;
      }>((resolve) => {
        const startTime = Date.now();

        const isWindows = process.platform === "win32";
        let proc;

        if (isWindows) {
          const fullCommand = `${claudePath} --dangerously-skip-permissions -p "Say hello"`;
          console.log("[Diagnose] Windows full command:", fullCommand);
          proc = spawn("cmd.exe", ["/c", fullCommand], {
            env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
            windowsHide: true,
          });
        } else {
          proc = spawn(
            claudePath,
            ["--dangerously-skip-permissions", "-p", "Say hello"],
            {
              env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
            },
          );
        }

        let stdout = "";
        let stderr = "";

        const timeout = setTimeout(() => {
          console.log("[Diagnose] Timeout, killing process");
          proc.kill();
          resolve({
            success: false,
            error: "Timeout (90s)",
            duration: Date.now() - startTime,
          });
        }, 90000);

        proc.stdout?.on("data", (data) => {
          const chunk = data.toString();
          stdout += chunk;
          console.log("[Diagnose] stdout chunk:", chunk.substring(0, 100));
        });

        proc.stderr?.on("data", (data) => {
          const chunk = data.toString();
          stderr += chunk;
          console.log("[Diagnose] stderr chunk:", chunk.substring(0, 100));
        });

        proc.on("close", (code) => {
          clearTimeout(timeout);
          console.log(
            "[Diagnose] Process closed, code:",
            code,
            "stdout length:",
            stdout.length,
          );
          resolve({
            success: code === 0,
            output: stdout.substring(0, 500),
            error:
              stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
            duration: Date.now() - startTime,
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          console.log("[Diagnose] Process error:", err.message);
          resolve({
            success: false,
            error: err.message,
            duration: Date.now() - startTime,
          });
        });
      });

      results.push({ step: "simple prompt test", ...promptResult });
      console.log("[Diagnose] Prompt test result:", promptResult);
    }

    return {
      claudePath,
      platform: process.platform,
      results,
      allPassed: results.every((r) => r.success),
    };
  })

  // Get task execution status
  .get(
    "/tasks/:id/execution-status",
    async ({ params }: { params: { id: string } }) => {
      try {
        const taskId = parseInt(params.id);

        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                agentExecutions: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        });

        if (!config || !config.agentSessions[0]) {
          return { status: "none", message: "実行履歴がありません" };
        }

        const latestSession = config.agentSessions[0];
        const latestExecution = latestSession.agentExecutions[0];

        const isWaitingForInput =
          latestExecution?.status === "waiting_for_input";
        const questionText = (latestExecution as any)?.question || null;
        // questionTypeはDBの値をそのまま使用（tool_call または none）
        // pattern_matchへのフォールバックは削除 - AIエージェントからの明確なステータスのみを信頼
        const questionType: "tool_call" | "none" =
          (latestExecution as any)?.questionType === "tool_call"
            ? "tool_call"
            : "none";

        // タイムアウト情報を取得
        let questionTimeoutInfo = null;
        if (isWaitingForInput && latestExecution?.id) {
          const timeoutInfo = orchestrator.getQuestionTimeoutInfo(
            latestExecution.id,
          );
          if (timeoutInfo) {
            questionTimeoutInfo = {
              remainingSeconds: timeoutInfo.remainingSeconds,
              deadline: timeoutInfo.deadline.toISOString(),
              totalSeconds: timeoutInfo.questionKey?.timeout_seconds || 300,
            };
          }
        }

        return {
          sessionId: latestSession.id,
          sessionStatus: latestSession.status,
          executionId: latestExecution?.id,
          executionStatus: latestExecution?.status,
          output: latestExecution?.output,
          errorMessage: latestExecution?.errorMessage,
          startedAt: latestExecution?.startedAt,
          completedAt: latestExecution?.completedAt,
          waitingForInput: isWaitingForInput,
          question: questionText,
          questionType,
          questionTimeout: questionTimeoutInfo,
        };
      } catch (error) {
        console.error("[execution-status] Error fetching status:", error);
        return {
          status: "error",
          message: "状態の取得中にエラーが発生しました",
        };
      }
    },
  )

  // Respond to agent (answer question)
  .post(
    "/tasks/:id/agent-respond",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { response: string };
    }) => {
      const taskId = parseInt(params.id);
      const { response } = body;

      if (!response?.trim()) {
        return { error: "Response is required" };
      }

      // まず実行情報を取得してロックとタイムアウトキャンセルを試みる
      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          task: { include: { theme: true } },
          agentSessions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              agentExecutions: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      if (!config || !config.agentSessions[0]) {
        return { error: "No active session found" };
      }

      const session = config.agentSessions[0];
      const latestExecution = session.agentExecutions[0];

      if (!latestExecution) {
        return { error: "No execution found" };
      }

      // オーケストレーターでロックを取得（他のプロセスと競合防止）
      if (
        !orchestrator.tryAcquireContinuationLock(
          latestExecution.id,
          "user_response",
        )
      ) {
        console.log(
          `[agent-respond] Execution ${latestExecution.id} is already being processed`,
        );
        return {
          error: "This execution is already being processed",
          currentStatus: "processing",
        };
      }

      try {
        // タイムアウトをキャンセル（ロック取得後に行う）
        orchestrator.cancelQuestionTimeout(latestExecution.id);

        // ステータス確認
        if (latestExecution.status !== "waiting_for_input") {
          orchestrator.releaseContinuationLock(latestExecution.id);
          return {
            error: "No execution waiting for input",
            currentStatus: latestExecution.status,
          };
        }

        // ステータスを running に更新
        await prisma.agentExecution.update({
          where: { id: latestExecution.id },
          data: { status: "running" },
        });

        const workingDirectory =
          config.task.theme?.workingDirectory || process.cwd();

        // 非同期で実行を継続
        // 注意: ロックは既にこのAPI内で取得済みなので、executeContinuationWithLockを使用
        orchestrator
          .executeContinuationWithLock(latestExecution.id, response.trim(), {
            timeout: 900000,
          })
          .then(async (execResult) => {
            if (execResult.success && !execResult.waitingForInput) {
              const diff = await orchestrator.getFullGitDiff(workingDirectory);
              if (diff && diff !== "No changes detected") {
                const structuredDiff =
                  await orchestrator.getDiff(workingDirectory);
                const implementationSummary =
                  execResult.output || "実装が完了しました。";

                const approvalRequest = await prisma.approvalRequest.create({
                  data: {
                    configId: config.id,
                    requestType: "code_review",
                    title: `「${config.task.title}」のコードレビュー`,
                    description: implementationSummary,
                    proposedChanges: toJsonString({
                      taskId,
                      sessionId: session.id,
                      workingDirectory,
                      diff,
                      structuredDiff,
                      implementationSummary,
                      executionTimeMs: execResult.executionTimeMs,
                    }),
                    estimatedChanges: toJsonString({
                      diff,
                      filesChanged: structuredDiff.length,
                      summary: implementationSummary.substring(0, 500),
                    }),
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                  },
                });

                await prisma.notification.create({
                  data: {
                    type: "pr_review_requested",
                    title: "コードレビュー依頼",
                    message: `「${config.task.title}」の実装が完了しました。レビューをお願いします。`,
                    link: `/approvals/${approvalRequest.id}`,
                  },
                });
              }
            }
          })
          .catch((error) => {
            console.error("Agent respond execution failed:", error);
            // エラー時もロックは自動的に解放される（executeContinuation内で）
          });

        return {
          success: true,
          message: "Response sent successfully",
          executionId: latestExecution.id,
        };
      } catch (error: any) {
        console.error("Agent respond failed:", error);
        // エラー時はロックを解放してステータスを元に戻す
        orchestrator.releaseContinuationLock(latestExecution.id);
        await prisma.agentExecution
          .update({
            where: { id: latestExecution.id },
            data: { status: "waiting_for_input" },
          })
          .catch(() => {});
        return { error: error.message || "Failed to send response" };
      }
    },
  )

  // Get session details
  .get(
    "/agents/sessions/:id",
    async ({ params }: { params: { id: string } }) => {
      return await prisma.agentSession.findUnique({
        where: { id: parseInt(params.id) },
        include: {
          agentActions: { orderBy: { createdAt: "desc" } },
          agentExecutions: {
            include: {
              agentConfig: true,
              gitCommits: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });
    },
  )

  // Stop session
  .post(
    "/agents/sessions/:id/stop",
    async ({ params }: { params: { id: string } }) => {
      const sessionId = parseInt(params.id);

      // オーケストレーターで停止を試みる
      const executions = orchestrator.getSessionExecutions(sessionId);
      for (const execution of executions) {
        await orchestrator.stopExecution(execution.executionId).catch(() => {});
      }

      // DBで実行中/待機中の実行をすべてキャンセル
      await prisma.agentExecution.updateMany({
        where: {
          sessionId,
          status: { in: ["running", "pending", "waiting_for_input"] },
        },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          errorMessage: "Manually stopped",
        },
      });

      await prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Manually stopped",
        },
      });

      return { success: true };
    },
  )

  // Get execution logs (for recovery after app restart)
  .get(
    "/tasks/:id/execution-logs",
    async ({
      params,
      query,
    }: {
      params: { id: string };
      query: { executionId?: string; afterSequence?: string };
    }) => {
      const taskId = parseInt(params.id);
      const executionId = query.executionId
        ? parseInt(query.executionId)
        : undefined;
      const afterSequence = query.afterSequence
        ? parseInt(query.afterSequence)
        : undefined;

      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              agentExecutions: {
                where: executionId ? { id: executionId } : {},
                orderBy: { createdAt: "desc" },
                take: 1,
                include: {
                  executionLogs: {
                    where: afterSequence
                      ? { sequenceNumber: { gt: afterSequence } }
                      : {},
                    orderBy: { sequenceNumber: "asc" },
                  },
                },
              },
            },
          },
        },
      });

      if (!config || !config.agentSessions[0]) {
        return { logs: [], lastSequence: 0, status: "none" };
      }

      const latestSession = config.agentSessions[0];
      const latestExecution = latestSession.agentExecutions[0];

      if (!latestExecution) {
        return { logs: [], lastSequence: 0, status: "none" };
      }

      const logs = latestExecution.executionLogs || [];
      const lastSequence =
        logs.length > 0 ? logs[logs.length - 1].sequenceNumber : 0;

      return {
        executionId: latestExecution.id,
        sessionId: latestSession.id,
        status: latestExecution.status,
        logs: logs.map(
          (log: {
            id: number;
            logChunk: string;
            logType: string;
            sequenceNumber: number;
            timestamp: Date;
          }) => ({
            id: log.id,
            chunk: log.logChunk,
            type: log.logType,
            sequence: log.sequenceNumber,
            timestamp: log.timestamp,
          }),
        ),
        lastSequence,
        output: latestExecution.output,
        errorMessage: latestExecution.errorMessage,
        question: (latestExecution as any).question,
        questionType: (latestExecution as any).questionType,
        questionDetails: (latestExecution as any).questionDetails,
        startedAt: latestExecution.startedAt,
        completedAt: latestExecution.completedAt,
      };
    },
  )

  // Stop task execution (rollback changes)
  .post(
    "/tasks/:id/stop-execution",
    async ({ params }: { params: { id: string } }) => {
      const taskId = parseInt(params.id);

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workingDirectory: true },
      });

      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            where: {
              status: { in: ["running", "pending"] },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!config || config.agentSessions.length === 0) {
        const runningExecution = await prisma.agentExecution.findFirst({
          where: {
            session: {
              config: {
                taskId,
              },
            },
            status: { in: ["running", "pending", "waiting_for_input"] },
          },
          orderBy: { createdAt: "desc" },
        });

        if (runningExecution) {
          // オーケストレーターで停止を試みる
          const stopped = await orchestrator
            .stopExecution(runningExecution.id)
            .catch(() => false);

          // 実行ログを削除
          await prisma.agentExecutionLog.deleteMany({
            where: { executionId: runningExecution.id },
          });
          console.log(
            `[stop-execution] Deleted execution logs for execution ${runningExecution.id}`,
          );

          // オーケストレーターで停止できなかった場合（メモリに存在しない場合など）でも
          // DBのステータスを確実に更新する
          if (!stopped) {
            await prisma.agentExecution.update({
              where: { id: runningExecution.id },
              data: {
                status: "cancelled",
                completedAt: new Date(),
                errorMessage: "Cancelled by user",
              },
            });
            console.log(
              `[stop-execution] Updated DB status for execution ${runningExecution.id} (not found in orchestrator)`,
            );
          }

          if (task?.workingDirectory) {
            try {
              await orchestrator.revertChanges(task.workingDirectory);
              console.log(
                `[stop-execution] Reverted changes in ${task.workingDirectory}`,
              );
            } catch (revertError) {
              console.error(
                `[stop-execution] Failed to revert changes:`,
                revertError,
              );
            }
          }

          return {
            success: true,
            message: "Execution cancelled and changes reverted",
          };
        }

        return { success: false, message: "No running execution found" };
      }

      const session = config.agentSessions[0];

      const executions = orchestrator.getSessionExecutions(session.id);
      for (const execution of executions) {
        await orchestrator.stopExecution(execution.executionId);
      }

      const pendingExecutions = await prisma.agentExecution.findMany({
        where: {
          sessionId: session.id,
          status: { in: ["running", "pending", "waiting_for_input"] },
        },
      });

      for (const execution of pendingExecutions) {
        // 実行ログを削除
        await prisma.agentExecutionLog.deleteMany({
          where: { executionId: execution.id },
        });

        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "cancelled",
            completedAt: new Date(),
            errorMessage: "Cancelled by user",
          },
        });
      }

      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Cancelled by user",
        },
      });

      if (task?.workingDirectory) {
        try {
          await orchestrator.revertChanges(task.workingDirectory);
          console.log(
            `[stop-execution] Reverted changes in ${task.workingDirectory}`,
          );
        } catch (revertError) {
          console.error(
            `[stop-execution] Failed to revert changes:`,
            revertError,
          );
        }
      }

      return {
        success: true,
        sessionId: session.id,
        message: "Execution cancelled and changes reverted",
      };
    },
  )

  // Get resumable executions (interrupted or stale running)
  // This handles both intentionally interrupted executions and ones left in "running" state after server restart
  .get("/agents/resumable-executions", async () => {
    try {
      // First, mark any "running" executions that are not actively running as "interrupted"
      // This handles the case where the server was restarted while an execution was in progress
      const activeExecutionIds = orchestrator
        .getActiveExecutions()
        .map((e) => e.executionId);

      // Find executions that are marked as "running" but not actually running in memory
      const staleRunningExecutions = await prisma.agentExecution.findMany({
        where: {
          status: { in: ["running", "pending"] },
          id: { notIn: activeExecutionIds },
        },
      });

      // Update stale executions to "interrupted" status
      if (staleRunningExecutions.length > 0) {
        console.log(
          `[resumable-executions] Found ${staleRunningExecutions.length} stale running executions, marking as interrupted`,
        );

        for (const exec of staleRunningExecutions) {
          await prisma.agentExecution.update({
            where: { id: exec.id },
            data: {
              status: "interrupted",
              errorMessage: `サーバー再起動により中断されました。\n\n【最後の出力】\n${(exec.output || "").slice(-1000)}`,
            },
          });
        }
      }

      // Now get all resumable executions (interrupted status)
      const resumableExecutions = await prisma.agentExecution.findMany({
        where: {
          status: "interrupted",
        },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
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
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return resumableExecutions.map((exec: any) => ({
        id: exec.id,
        taskId: exec.session.config?.task?.id,
        taskTitle: exec.session.config?.task?.title,
        sessionId: exec.sessionId,
        status: exec.status,
        claudeSessionId: exec.claudeSessionId,
        errorMessage: exec.errorMessage,
        output: exec.output?.slice(-500), // 最後の500文字のみ
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        createdAt: exec.createdAt,
        workingDirectory: exec.session.config?.task?.theme?.workingDirectory,
        canResume: true, // All interrupted executions can be resumed
      }));
    } catch (error) {
      console.error("[resumable-executions] Error:", error);
      return [];
    }
  })

  // Legacy endpoint for backwards compatibility
  .get("/agents/interrupted-executions", async () => {
    try {
      const interruptedExecutions = await prisma.agentExecution.findMany({
        where: {
          status: "interrupted",
        },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return interruptedExecutions.map((exec: any) => ({
        id: exec.id,
        taskId: exec.session.config?.task?.id,
        taskTitle: exec.session.config?.task?.title,
        sessionId: exec.sessionId,
        status: exec.status,
        claudeSessionId: exec.claudeSessionId,
        errorMessage: exec.errorMessage,
        output: exec.output?.slice(-500), // 最後の500文字のみ
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        createdAt: exec.createdAt,
        canResume: !!exec.claudeSessionId, // Claude Session IDがあれば再開可能
      }));
    } catch (error) {
      console.error("[interrupted-executions] Error:", error);
      return [];
    }
  })

  // Get system status (including shutdown state)
  .get("/agents/system-status", async () => {
    const activeExecutions = orchestrator.getActiveExecutionCount?.() || 0;
    const isShuttingDown = orchestrator.isInShutdown();

    // 実行中の状態が残っている実行を取得
    const runningExecutions = await prisma.agentExecution.count({
      where: {
        status: { in: ["running", "pending"] },
      },
    });

    // 中断された実行を取得
    const interruptedExecutions = await prisma.agentExecution.count({
      where: {
        status: "interrupted",
      },
    });

    return {
      isShuttingDown,
      activeExecutions,
      runningExecutions,
      interruptedExecutions,
      serverTime: new Date().toISOString(),
    };
  })

  // Mark interrupted execution as acknowledged (to clear it from the list)
  .post(
    "/agents/executions/:id/acknowledge",
    async ({ params }: { params: { id: string } }) => {
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
    },
  )

  // Resume interrupted execution
  .post(
    "/agents/executions/:id/resume",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body?: { timeout?: number };
    }) => {
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
        console.log(`[resume] Task ${task.id} has ${subtasks.length} in-progress subtasks`);

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
          console.log(`[resume] Starting parallel execution for task ${task.id} with ${subtasks.length} in-progress subtasks`);

          // 並列実行を開始
          const executor = getParallelExecutor();

          // サブタスクの依存関係を分析
          const analysisResult = await executor.analyzeDependencies({
            parentTaskId: task.id,
            subtasks: subtasks.map((st: any) => ({
              id: st.id,
              title: st.title,
              description: st.description || "",
              estimatedHours: st.estimatedHours || 1,
              priority: st.priority || "medium",
              dependencies: [], // TODO: 依存関係を取得
            })),
          });

          // 非同期で並列実行を開始（analysisResult.treeMap.nodesを使用）
          executor
            .startSession(task.id, analysisResult.plan, analysisResult.treeMap.nodes, workingDirectory)
            .then(async (session) => {
              console.log(`[resume] Parallel execution session started: ${session.sessionId}`);
            })
            .catch(async (error) => {
              console.error("[resume] Parallel execution error:", error);
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

        // サブタスクがない場合は通常の再開
        orchestrator
          .resumeInterruptedExecution(executionId, {
            timeout: body?.timeout || 900000,
          })
          .then(async (result) => {
            if (result.success && !result.waitingForInput) {
              const diff = await orchestrator.getFullGitDiff(workingDirectory);
              if (diff && diff !== "No changes detected") {
                const structuredDiff =
                  await orchestrator.getDiff(workingDirectory);
                const implementationSummary =
                  result.output || "再開した作業が完了しました。";

                const config = execution.session.config;
                if (config) {
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
                        diff,
                        structuredDiff,
                        implementationSummary,
                        executionTimeMs: result.executionTimeMs,
                        resumed: true,
                      }),
                      estimatedChanges: toJsonString({
                        diff,
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
            } else if (!result.success) {
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
            console.error("[resume] Resume execution error:", error);
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
        console.error("[resume] Error:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to resume execution",
        };
      }
    },
  )

  // Reset execution state for a task (allows re-running)
  .post(
    "/tasks/:id/reset-execution-state",
    async ({ params }: { params: { id: string } }) => {
      const taskId = parseInt(params.id);

      try {
        // Find the developer mode config for this task
        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                agentExecutions: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        });

        if (!config) {
          return { success: false, error: "Developer mode config not found" };
        }

        const latestSession = config.agentSessions[0];
        const latestExecution = latestSession?.agentExecutions[0];

        // If there's a running execution, stop it first
        if (
          latestExecution &&
          ["running", "pending", "waiting_for_input"].includes(
            latestExecution.status,
          )
        ) {
          // Try to stop via orchestrator
          await orchestrator.stopExecution(latestExecution.id).catch(() => {});
        }

        // Reset the latest execution status
        if (latestExecution) {
          await prisma.agentExecution.update({
            where: { id: latestExecution.id },
            data: {
              status: "reset",
              completedAt: new Date(),
              errorMessage: null,
              question: null,
              questionType: null,
              questionDetails: null,
            },
          });

          // Delete execution logs to free up space
          await prisma.agentExecutionLog.deleteMany({
            where: { executionId: latestExecution.id },
          });
        }

        // Reset the session status
        if (latestSession) {
          await prisma.agentSession.update({
            where: { id: latestSession.id },
            data: {
              status: "reset",
              completedAt: new Date(),
              errorMessage: null,
            },
          });
        }

        console.log(
          `[reset-execution-state] Task ${taskId} execution state reset`,
        );

        return {
          success: true,
          message: "Execution state reset successfully",
          resetSessionId: latestSession?.id,
          resetExecutionId: latestExecution?.id,
        };
      } catch (error) {
        console.error("[reset-execution-state] Error:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to reset execution state",
        };
      }
    },
  );
