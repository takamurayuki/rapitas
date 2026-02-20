/**
 * AI Agent API Routes
 * Agent configuration, task execution, and session management
 */
import { Elysia, t } from "elysia";
import { join } from "path";
import { prisma } from "../config/database";
import { agentFactory } from "../services/agents/agent-factory";
import { orchestrator } from "./approvals";
import { toJsonString, fromJsonString } from "../utils/db-helpers";
import { ParallelExecutor } from "../services/parallel-execution/parallel-executor";
import type { TaskPriority } from "../services/parallel-execution/types";
import {
  encrypt,
  decrypt,
  maskApiKey,
  isEncryptionKeyConfigured,
} from "../utils/encryption";
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
import {
  captureScreenshotsForDiff,
  type ScreenshotResult,
} from "../services/screenshot-service";
import { realtimeService } from "../services/realtime-service";
import { getModelsForAgentType, getAllModels } from "../utils/agent-models";

/**
 * スクリーンショット結果からフロントエンド表示に不要な path（ファイルシステムパス）を除外する
 */
function sanitizeScreenshots(screenshots: ScreenshotResult[]) {
  return screenshots.map(({ path, ...rest }) => rest);
}

/**
 * AgentExecution に question/questionType/questionDetails/claudeSessionId が
 * DB 上は存在するが Prisma の型定義に含まれないケースを安全にキャストするための型
 */
type ExecutionWithExtras = {
  question?: string | null;
  questionType?: string | null;
  questionDetails?: string | null;
  claudeSessionId?: string | null;
};

/**
 * エージェント出力からクリーンな実装サマリーを抽出する。
 * ログ出力やデバッグ情報、重複する説明を除去し、ユーザーが分かりやすい簡潔な説明にまとめる。
 */
function cleanImplementationSummary(rawOutput: string): string {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return "実装が完了しました。";
  }

  const lines = rawOutput.split("\n");
  const cleanedLines: string[] = [];
  const seenContent = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行はスキップ（後で必要に応じて追加）
    if (trimmed === "") continue;

    // ログ出力パターンを除外
    if (/^\[(?:実行開始|実行中|API|DEBUG|INFO|WARN|ERROR|LOG)\]/.test(trimmed))
      continue;
    if (/^\[[\d\-T:.Z]+\]/.test(trimmed)) continue; // タイムスタンプ付きログ
    if (/^(?:>|>>|\$)\s/.test(trimmed)) continue; // コマンド実行行
    if (/^(?:npm|bun|yarn|pnpm)\s(?:run|install|build|test|exec)/.test(trimmed))
      continue;
    if (
      /^(?:Running|Executing|Starting|Compiling|Building|Installing)[\s:]/.test(
        trimmed,
      )
    )
      continue;
    if (/^(?:stdout|stderr|exit code|pid|process)[\s:]/i.test(trimmed))
      continue;
    if (/^(?:✓|✗|✔|✘|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(trimmed)) continue; // スピナー・チェックマーク
    if (/^(?:warning|error|info|debug|trace|verbose)\s*:/i.test(trimmed))
      continue;
    if (
      /^(?:at\s+|Error:|TypeError:|ReferenceError:|SyntaxError:)/.test(trimmed)
    )
      continue; // スタックトレース
    if (/^(?:\d+\s+(?:passing|failing|pending))/.test(trimmed)) continue; // テスト結果の詳細行
    if (/console\.(?:log|error|warn|info|debug)\s*\(/.test(trimmed)) continue; // console.log呼び出し
    if (/^[\-=]{3,}$/.test(trimmed)) continue; // 区切り線
    if (/^#{4,}\s/.test(trimmed)) continue; // 深すぎる見出し（h4以下）は除外

    // 重複コンテンツを除去（正規化して比較）
    const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
    if (seenContent.has(normalized)) continue;
    seenContent.add(normalized);

    cleanedLines.push(line);
  }

  let result = cleanedLines.join("\n").trim();

  // 結果が空なら元のテキストの先頭部分を使用
  if (result.length === 0) {
    result = rawOutput.trim().substring(0, 500);
  }

  // 長すぎる場合は切り詰める（マークダウンの構造を壊さないように段落単位で）
  if (result.length > 2000) {
    const paragraphs = result.split(/\n\n+/);
    let truncated = "";
    for (const paragraph of paragraphs) {
      if (truncated.length + paragraph.length > 1800) break;
      truncated += (truncated ? "\n\n" : "") + paragraph;
    }
    result = truncated || result.substring(0, 1800);
  }

  return result;
}

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
  // Agent configuration list (active only)
  .get("/agents", async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 開発用とレビュー用のエージェントのみを返す
    const filteredAgents = agents.filter((agent: (typeof agents)[0]) => {
      // 開発用エージェント設定を確認
      const isDevelopmentAgent = agent.name.includes("Development Agent");
      // レビュー用エージェント設定を確認
      const isReviewAgent = agent.name.includes("Review Agent");
      // デフォルトエージェント
      const isDefaultAgent = agent.isDefault;

      return isDevelopmentAgent || isReviewAgent || isDefaultAgent;
    });

    return filteredAgents.map((agent: (typeof filteredAgents)[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Agent configuration list (all, including inactive - for management page)
  .get("/agents/all", async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: [
        { isDefault: "desc" },
        { isActive: "desc" },
        { createdAt: "desc" },
      ],
    });
    return agents.map((agent: (typeof agents)[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Toggle agent active status
  .put(
    "/agents/:id/toggle-active",
    async (context: any) => {
      const { params } = context;
      const agentId = parseInt(params.id, 10);
      if (isNaN(agentId)) {
        return { error: "Invalid agent ID" };
      }

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent) {
        return { error: "Agent not found" };
      }

      // デフォルトエージェントは無効化できない
      if (agent.isDefault && agent.isActive) {
        return {
          error:
            "デフォルトエージェントは無効化できません。先に別のエージェントをデフォルトに設定してください。",
        };
      }

      const updated = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { isActive: !agent.isActive },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "update",
        changeDetails: {
          isActive: { from: agent.isActive, to: updated.isActive },
        },
        previousValues: { isActive: agent.isActive },
        newValues: { isActive: updated.isActive },
      });

      return updated;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get default agent configuration
  .get("/agents/default", async () => {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (!defaultAgent) {
      // DBにデフォルトエージェントが設定されていない場合、組み込みのClaude Codeをフォールバックとして返す
      return {
        id: null,
        agentType: "claude-code",
        name: "Claude Code Agent",
        modelId: null,
        isDefault: true,
        isActive: true,
        isBuiltinFallback: true,
      };
    }
    return {
      ...defaultAgent,
      capabilities: fromJsonString(defaultAgent.capabilities) ?? {},
      isBuiltinFallback: false,
    };
  })

  // Set default agent by ID
  .put(
    "/agents/:id/set-default",
    async (context: any) => {
      const { params } = context;
      const agentId = parseInt(params.id, 10);
      if (isNaN(agentId)) {
        return { error: "Invalid agent ID" };
      }

      // 対象エージェントが存在・アクティブか確認
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent || !agent.isActive) {
        return { error: "Agent not found or inactive" };
      }

      // 既存のデフォルトを解除
      await prisma.aIAgentConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });

      // 新しいデフォルトを設定
      const updated = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { isDefault: true },
      });

      // 監査ログを記録
      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "update",
        previousValues: { isDefault: false },
        newValues: { isDefault: true },
      });

      console.log(
        `[agents] Default agent changed to: ${updated.name} (${updated.agentType})`,
      );
      return updated;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Clear default agent (revert to built-in Claude Code)
  .delete("/agents/default", async () => {
    await prisma.aIAgentConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    console.log(
      "[agents] Default agent cleared, reverting to built-in Claude Code",
    );
    return {
      success: true,
      message: "Default agent cleared. Will use built-in Claude Code.",
    };
  })

  // Create agent configuration
  .post(
    "/agents",
    async (context: any) => {
      const { body } = context;
      const {
        agentType,
        name,
        apiKey,
        endpoint,
        modelId,
        capabilities,
        isDefault,
      } = body as any;

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
          console.warn(
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
    async (context: any) => {
      const { params, body } = context;
      const { id } = params as any;
      const {
        name,
        apiKey,
        clearApiKey,
        endpoint,
        modelId,
        capabilities,
        isDefault,
        isActive,
      } = body as any;

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
          console.warn(
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
    async (context: any) => {
      const { params, set } = context;
      const { id } = params as any;
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
          console.error(
            `[agents] Failed to decrypt API key for agent ${id}:`,
            e,
          );
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
    async (context: any) => {
      const { params } = context;
      const { id } = params as any;

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
    async (context: any) => {
      const { params, body, set } = context;
      const { id } = params as any;
      const { apiKey } = body as any;

      if (!apiKey) {
        set.status = 400;
        return { error: "API key is required" };
      }

      if (!isEncryptionKeyConfigured()) {
        console.warn(
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
    async (context: any) => {
      const { params, set } = context;
      const { id } = params as any;

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

  // Test connection for agent (alias for test-connection)
  .post(
    "/agents/:id/test",
    async (context: any) => {
      const { params, set } = context;
      const { id } = params as any;
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
  .get("/agents/models", async (context: any) => {
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
    async (context: any) => {
      const { body } = context;
      const { type, model } = body as any;

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
  .get(
    "/agents/config-schema/:agentType",
    async ({ params, set }) => {
      const { agentType } = params;
      const schema = getAgentConfigSchema(agentType);

      if (!schema) {
        set.status = 404;
        return { error: `Unknown agent type: ${agentType}` };
      }

      return { schema };
    },
    {
      params: t.Object({
        agentType: t.String(),
      }),
    },
  )

  // Validate agent configuration
  .post("/agents/validate-config", async ({ body, set }) => {
    const { agentType, apiKey, endpoint, modelId, additionalConfig } =
      body as any;

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

  // Get audit logs for a specific agent
  .get("/agents/:id/audit-logs", async (context) => {
    const { params, query } = context;
    const { id } = params as any;
    const limit = query.limit ? parseInt(query.limit) : 50;

    const logs = await getAgentConfigAuditLogs(parseInt(id), limit);
    return { logs };
  })

  // Get recent audit logs (all agents)
  .get("/agents/audit-logs/recent", async (context: any) => {
    const { query } = context;
    const limit = query.limit ? parseInt(query.limit) : 100;
    const logs = await getRecentAuditLogs(limit);
    return { logs };
  })

  // Test API key connection for an agent
  .post("/agents/:id/test-connection", async (context) => {
    const { id } = context.params as any;
    const agent = await prisma.aIAgentConfig.findUnique({
      where: { id: parseInt(id) },
    });

    if (!agent) {
      context.status(404);
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
      // TODO: OpenAI, Gemini等の接続テスト実装
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

  // Execute agent on task
  .post("/tasks/:id/execute", async (context) => {
    const params = context.params as { id: string };
    const body = context.body as {
      agentConfigId?: number;
      workingDirectory?: string;
      timeout?: number;
      instruction?: string;
      branchName?: string;
      useTaskAnalysis?: boolean;
      optimizedPrompt?: string;
      sessionId?: number;
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
      sessionId,
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
      context.status(404);
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

    // 継続実行の場合は既存のセッションを使用、なければ新規作成
    let session;
    if (sessionId) {
      // 既存のセッションを取得して検証
      const existingSession = await prisma.agentSession.findUnique({
        where: { id: sessionId },
      });
      if (!existingSession) {
        context.set.status = 404;
        return { error: "Session not found" };
      }
      if (existingSession.configId !== developerModeConfig.id) {
        context.set.status = 400;
        return { error: "Session does not belong to this task" };
      }
      // セッションを再利用
      session = existingSession;
      console.log(
        `[API] Continuing execution with existing session ${sessionId}`,
      );
    } else {
      // 新規セッション作成
      session = await prisma.agentSession.create({
        data: {
          configId: developerModeConfig.id,
          status: "pending",
        },
      });
      console.log(`[API] Created new session ${session.id}`);
    }

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
          const analysisOutput = fromJsonString<Record<string, unknown>>(
            latestAnalysisAction.output,
          );
          if (analysisOutput?.summary && analysisOutput?.suggestedSubtasks) {
            analysisInfo = {
              summary: analysisOutput.summary as string,
              complexity:
                (analysisOutput.complexity as
                  | "simple"
                  | "medium"
                  | "complex") || "medium",
              estimatedTotalHours:
                (analysisOutput.estimatedTotalHours as number) || 0,
              subtasks: (
                (analysisOutput.suggestedSubtasks as Array<{
                  title: string;
                  description?: string;
                  estimatedHours?: number;
                  priority?: string;
                  order?: number;
                  dependencies?: number[];
                }>) || []
              ).map((st) => ({
                title: st.title,
                description: st.description || "",
                estimatedHours: st.estimatedHours || 0,
                priority:
                  (st.priority as "low" | "medium" | "high" | "urgent") ||
                  "medium",
                order: st.order || 0,
                dependencies: st.dependencies,
              })),
              reasoning: (analysisOutput.reasoning as string) || "",
              tips: analysisOutput.tips as string[] | undefined,
            };
            console.log(`[API] Using AI task analysis for task ${taskIdNum}`);
            console.log(
              `[API] Analysis subtasks count: ${analysisInfo!.subtasks.length}`,
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
        if (result.waitingForInput) {
          // 質問待ち状態: タスクは実行中のまま維持（todoに戻さない）
          // ユーザーの回答を待ってから同じセッションで継続する
          console.log(
            `[API] Task ${taskIdNum} is waiting for user input, keeping status as 'in_progress'`,
          );
          await prisma.task
            .update({
              where: { id: taskIdNum },
              data: { status: "in_progress" },
            })
            .catch((e: unknown) => {
              console.error(
                `[API] Failed to update task ${taskIdNum} status to in_progress:`,
                e,
              );
            });

          // セッションも実行中のまま維持
          await prisma.agentSession
            .update({
              where: { id: session.id },
              data: {
                status: "running",
                lastActivityAt: new Date(),
              },
            })
            .catch((e: unknown) => {
              console.error(
                `[API] Failed to update session ${session.id} status to running:`,
                e,
              );
            });
        } else if (result.success) {
          // タスクのステータスを「完了」に更新
          await prisma.task.update({
            where: { id: taskIdNum },
            data: {
              status: "done",
              completedAt: new Date(),
            },
          });
          console.log(`[API] Updated task ${taskIdNum} status to 'done'`);

          // セッションのステータスも完了に更新
          await prisma.agentSession
            .update({
              where: { id: session.id },
              data: {
                status: "completed",
                completedAt: new Date(),
              },
            })
            .catch((e: unknown) => {
              console.error(
                `[API] Failed to update session ${session.id} status:`,
                e,
              );
            });

          const diff = await orchestrator.getFullGitDiff(workDir);
          const structuredDiff = await orchestrator.getDiff(workDir);

          if (diff && diff !== "No changes detected") {
            const implementationSummary = cleanImplementationSummary(
              result.output || "実装が完了しました。",
            );

            // UI変更がある場合はスクリーンショットを撮影
            let screenshots: ScreenshotResult[] = [];
            try {
              screenshots = await captureScreenshotsForDiff(structuredDiff, {
                workingDirectory: workDir,
                agentOutput: result.output || "",
              });
              if (screenshots.length > 0) {
                console.log(
                  `[API] Captured ${screenshots.length} screenshots for task ${taskIdNum}: ${screenshots.map((s) => s.page).join(", ")}`,
                );
              }
            } catch (screenshotErr) {
              console.warn(
                "[API] Screenshot capture failed (non-fatal):",
                screenshotErr,
              );
            }

            const screenshotData = sanitizeScreenshots(screenshots);
            console.log(
              `[API] Creating approval with ${screenshotData.length} screenshot(s): ${screenshotData.map((s) => s.url).join(", ")}`,
            );
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
                  structuredDiff,
                  implementationSummary,
                  executionTimeMs: result.executionTimeMs,
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
          console.log(
            `[API] Reverted task ${taskIdNum} status to 'todo' due to failure`,
          );

          // セッションのステータスも失敗に更新
          await prisma.agentSession
            .update({
              where: { id: session.id },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: result.errorMessage || "Execution failed",
              },
            })
            .catch((e: unknown) => {
              console.error(
                `[API] Failed to update session ${session.id} status:`,
                e,
              );
            });

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
        await prisma.task
          .update({
            where: { id: taskIdNum },
            data: {
              status: "todo",
            },
          })
          .catch(() => {});
        console.log(
          `[API] Reverted task ${taskIdNum} status to 'todo' due to error`,
        );

        // セッションのステータスも失敗に更新
        await prisma.agentSession
          .update({
            where: { id: session.id },
            data: {
              status: "failed",
              completedAt: new Date(),
              errorMessage: error.message || "Execution error",
            },
          })
          .catch(() => {});

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
  })

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
  .get("/tasks/:id/execution-status", async (context: any) => {
    const { params } = context;
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
                include: {
                  agentConfig: {
                    select: {
                      id: true,
                      agentType: true,
                      name: true,
                      modelId: true,
                    },
                  },
                },
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
      const execExtras = latestExecution as typeof latestExecution &
        ExecutionWithExtras;

      const isWaitingForInput = latestExecution?.status === "waiting_for_input";
      const questionText = execExtras?.question || null;
      // questionTypeはDBの値をそのまま使用（tool_call または none）
      // pattern_matchへのフォールバックは削除 - AIエージェントからの明確なステータスのみを信頼
      const questionType: "tool_call" | "none" =
        execExtras?.questionType === "tool_call" ? "tool_call" : "none";

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

      // エージェント設定情報を取得
      const agentConfigInfo = (latestExecution as Record<string, unknown>)
        ?.agentConfig as {
        id: number;
        agentType: string;
        name: string;
        modelId: string | null;
      } | null;

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
        claudeSessionId: execExtras?.claudeSessionId || null,
        agentConfig: agentConfigInfo || null,
      };
    } catch (error) {
      console.error("[execution-status] Error fetching status:", error);
      return {
        status: "error",
        message: "状態の取得中にエラーが発生しました",
      };
    }
  })

  // Respond to agent (answer question)
  .post("/tasks/:id/agent-respond", async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { response: string };
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

      // ステータスを running に更新（質問フィールドもクリアしてレースコンディションを防止）
      await prisma.agentExecution.update({
        where: { id: latestExecution.id },
        data: {
          status: "running",
          question: null,
          questionType: null,
          questionDetails: null,
        },
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
          if (execResult.waitingForInput) {
            // 質問待ち状態: タスクはin_progressのまま維持
            // ユーザーの回答を待ってから同じセッションで継続する
            console.log(
              `[agent-respond] Task ${taskId} is waiting for another user input, keeping session active`,
            );
            await prisma.task
              .update({
                where: { id: taskId },
                data: { status: "in_progress" },
              })
              .catch((e: unknown) => {
                console.error(
                  `[agent-respond] Failed to update task ${taskId} status to in_progress:`,
                  e,
                );
              });

            // セッションも実行中のまま維持
            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: "running",
                  lastActivityAt: new Date(),
                },
              })
              .catch((e: unknown) => {
                console.error(
                  `[agent-respond] Failed to update session ${session.id} status to running:`,
                  e,
                );
              });
          } else if (execResult.success) {
            // タスクのステータスを完了に更新
            await prisma.task
              .update({
                where: { id: taskId },
                data: {
                  status: "done",
                  completedAt: new Date(),
                },
              })
              .catch((e: unknown) => {
                console.error(
                  `[agent-respond] Failed to update task ${taskId} status:`,
                  e,
                );
              });
            console.log(
              `[agent-respond] Updated task ${taskId} status to 'done'`,
            );

            // セッションのステータスも完了に更新
            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: "completed",
                  completedAt: new Date(),
                },
              })
              .catch((e: unknown) => {
                console.error(
                  `[agent-respond] Failed to update session ${session.id} status:`,
                  e,
                );
              });

            const diff = await orchestrator.getFullGitDiff(workingDirectory);
            if (diff && diff !== "No changes detected") {
              const structuredDiff =
                await orchestrator.getDiff(workingDirectory);
              const implementationSummary = cleanImplementationSummary(
                execResult.output || "実装が完了しました。",
              );

              // UI変更がある場合はスクリーンショットを撮影
              let screenshots: ScreenshotResult[] = [];
              try {
                screenshots = await captureScreenshotsForDiff(structuredDiff, {
                  workingDirectory,
                  agentOutput: execResult.output || "",
                });
                if (screenshots.length > 0) {
                  console.log(
                    `[agent-respond] Captured ${screenshots.length} screenshots for task ${taskId}: ${screenshots.map((s) => s.page).join(", ")}`,
                  );
                }
              } catch (screenshotErr) {
                console.warn(
                  "[agent-respond] Screenshot capture failed (non-fatal):",
                  screenshotErr,
                );
              }

              const screenshotData = sanitizeScreenshots(screenshots);
              console.log(
                `[agent-respond] Creating approval with ${screenshotData.length} screenshot(s): ${screenshotData.map((s) => s.url).join(", ")}`,
              );
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
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: execResult.executionTimeMs,
                    screenshots: screenshotData,
                  }),
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
                  title: "コードレビュー依頼",
                  message: `「${config.task.title}」の実装が完了しました。レビューをお願いします。`,
                  link: `/approvals/${approvalRequest.id}`,
                },
              });
            }
          } else {
            // 失敗時はタスクステータスを todo に戻す
            await prisma.task
              .update({
                where: { id: taskId },
                data: { status: "todo" },
              })
              .catch(() => {});

            // セッションのステータスも失敗に更新
            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage: execResult.errorMessage || "Execution failed",
                },
              })
              .catch(() => {});
          }
        })
        .catch(async (error) => {
          const errorMsg = error.message || "Unknown error";
          const isSessionError =
            /session|expired|invalid|not found|code 1|SIGTERM|timeout/i.test(
              errorMsg,
            );
          console.error(
            `Agent respond execution failed (sessionError: ${isSessionError}):`,
            errorMsg,
          );

          // エラー時はタスクステータスを todo に戻す
          await prisma.task
            .update({
              where: { id: taskId },
              data: { status: "todo" },
            })
            .catch(() => {});

          // 実行レコードのステータスを失敗に更新
          // 質問フィールドもクリアして、フロントエンドが古い質問を再表示しないようにする
          const detailedErrorMessage = isSessionError
            ? `セッション再開に失敗しました（全てのフォールバックが失敗）: ${errorMsg}`
            : `回答送信後の実行継続に失敗しました: ${errorMsg}`;
          await prisma.agentExecution
            .update({
              where: { id: latestExecution.id },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: detailedErrorMessage,
                question: null,
                questionType: null,
                questionDetails: null,
              },
            })
            .catch(() => {});

          // セッションのステータスも失敗に更新
          await prisma.agentSession
            .update({
              where: { id: session.id },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: detailedErrorMessage,
              },
            })
            .catch(() => {});
        });

      return {
        success: true,
        message: "Response sent successfully",
        executionId: latestExecution.id,
      };
    } catch (error) {
      console.error("Agent respond failed:", error);
      // エラー時はロックを解放してステータスを元に戻す（同期エラーなので実行はまだ開始されていない）
      orchestrator.releaseContinuationLock(latestExecution.id);
      // ステータスをwaiting_for_inputに戻し、元の質問も復元する
      await prisma.agentExecution
        .update({
          where: { id: latestExecution.id },
          data: {
            status: "waiting_for_input",
            question: latestExecution.question,
            questionType: latestExecution.questionType,
            questionDetails: latestExecution.questionDetails,
          },
        })
        .catch(() => {});
      return {
        error:
          error instanceof Error ? error.message : "Failed to send response",
      };
    }
  })

  // Get session details
  .get("/agents/sessions/:id", async (context: any) => {
    const { params } = context;
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
  })

  // Stop session
  .post("/agents/sessions/:id/stop", async (context: any) => {
    const { params } = context;
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
  })

  // Get execution logs (for recovery after app restart)
  .get("/tasks/:id/execution-logs", async (context) => {
    const params = context.params as { id: string };
    const query = context.query as {
      executionId?: string;
      afterSequence?: string;
    };
    const taskId = parseInt(params.id);
    const executionId = query.executionId
      ? parseInt(query.executionId)
      : undefined;
    const afterSequence = query.afterSequence
      ? parseInt(query.afterSequence)
      : undefined;

    // 互換性のため: executionId / afterSequence が指定されている場合は従来通り
    // 「単一 execution のログ」を返す（差分取得用途）
    const singleExecutionMode =
      !!executionId || typeof afterSequence === "number";

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
              take: singleExecutionMode ? 1 : 50,
              include: {
                executionLogs: {
                  where: singleExecutionMode
                    ? afterSequence
                      ? { sequenceNumber: { gt: afterSequence } }
                      : {}
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
    const executions = latestSession.agentExecutions || [];

    if (executions.length === 0) {
      return { logs: [], lastSequence: 0, status: "none" };
    }

    // 単一 execution モードは従来互換のレスポンス
    if (singleExecutionMode) {
      const latestExecution = executions[0];
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
        question: (
          latestExecution as typeof latestExecution & ExecutionWithExtras
        ).question,
        questionType: (
          latestExecution as typeof latestExecution & ExecutionWithExtras
        ).questionType,
        questionDetails: (
          latestExecution as typeof latestExecution & ExecutionWithExtras
        ).questionDetails,
        startedAt: latestExecution.startedAt,
        completedAt: latestExecution.completedAt,
      };
    }

    // 復元用途: 最新セッション内の複数 execution のログを結合して返す
    // - createdAt 昇順で execution を並べ、各 execution 内は sequenceNumber 昇順
    const executionsAsc = [...executions].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const combinedLogs = executionsAsc.flatMap((exec) => {
      const execLogs = exec.executionLogs || [];
      return execLogs.map(
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
          executionId: exec.id,
        }),
      );
    });

    const latestExecution = executions[0];
    const latestLogs = latestExecution.executionLogs || [];
    const lastSequence =
      latestLogs.length > 0
        ? latestLogs[latestLogs.length - 1].sequenceNumber
        : 0;

    return {
      executionId: latestExecution.id,
      sessionId: latestSession.id,
      status: latestExecution.status,
      logs: combinedLogs,
      lastSequence,
      output: latestExecution.output,
      errorMessage: latestExecution.errorMessage,
      question: (
        latestExecution as typeof latestExecution & ExecutionWithExtras
      ).question,
      questionType: (
        latestExecution as typeof latestExecution & ExecutionWithExtras
      ).questionType,
      questionDetails: (
        latestExecution as typeof latestExecution & ExecutionWithExtras
      ).questionDetails,
      startedAt: latestExecution.startedAt,
      completedAt: latestExecution.completedAt,
    };
  })

  // Stop task execution (rollback changes)
  .post("/tasks/:id/stop-execution", async (context: any) => {
    const { params } = context;
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
  })

  // Get resumable executions (interrupted or stale running)
  // This handles both intentionally interrupted executions and ones left in "running" state after server restart
  .get("/agents/resumable-executions", async () => {
    try {
      // Stale execution recovery is handled at startup by orchestrator.recoverStaleExecutions()
      // This endpoint only reads data — no recovery logic here to avoid race conditions
      // with newly created executions that haven't been added to activeExecutions yet.

      const currentActiveIds = orchestrator
        .getActiveExecutions()
        .map((e) => e.executionId);

      const resumableExecutions = await prisma.agentExecution.findMany({
        where: {
          OR: [
            // 中断された実行（再開可能）
            { status: "interrupted" },
            // 実際にメモリ上でアクティブな実行のみ
            {
              status: { in: ["running", "waiting_for_input"] },
              id: { in: currentActiveIds.length > 0 ? currentActiveIds : [-1] },
            },
          ],
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

      return resumableExecutions.map(
        (exec: (typeof resumableExecutions)[number]) => {
          const execWithExtras = exec as typeof exec & ExecutionWithExtras;
          return {
            id: exec.id,
            taskId: exec.session.config?.task?.id,
            taskTitle: exec.session.config?.task?.title,
            sessionId: exec.sessionId,
            status: exec.status,
            claudeSessionId: execWithExtras.claudeSessionId,
            errorMessage: exec.errorMessage,
            output: exec.output?.slice(-500), // 最後の500文字のみ
            startedAt: exec.startedAt,
            completedAt: exec.completedAt,
            createdAt: exec.createdAt,
            workingDirectory:
              exec.session.config?.task?.theme?.workingDirectory,
            canResume: exec.status === "interrupted", // Only interrupted can be resumed
          };
        },
      );
    } catch (error) {
      const errObj = error as { code?: string; message?: string };
      if (errObj?.code === "P1001") {
        console.warn("[resumable-executions] Database unreachable, skipping");
      } else {
        console.error(
          "[resumable-executions] Error:",
          error instanceof Error ? error.message : String(error),
        );
      }
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

      return interruptedExecutions.map(
        (exec: (typeof interruptedExecutions)[number]) => {
          const execWithExtras = exec as typeof exec & ExecutionWithExtras;
          return {
            id: exec.id,
            taskId: exec.session.config?.task?.id,
            taskTitle: exec.session.config?.task?.title,
            sessionId: exec.sessionId,
            status: exec.status,
            claudeSessionId: execWithExtras.claudeSessionId,
            errorMessage: exec.errorMessage,
            output: exec.output?.slice(-500), // 最後の500文字のみ
            startedAt: exec.startedAt,
            completedAt: exec.completedAt,
            createdAt: exec.createdAt,
            canResume: !!execWithExtras.claudeSessionId, // Claude Session IDがあれば再開可能
          };
        },
      );
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
  .post("/agents/executions/:id/acknowledge", async (context: any) => {
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
      console.log(
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
        console.log(
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
            explicitDependencies: [] as number[], // TODO: 依存関係を取得
          })),
        });

        // 非同期で並列実行を開始（analysisResult.treeMap.nodesを使用）
        executor
          .startSession(
            task.id,
            analysisResult.plan,
            analysisResult.treeMap.nodes,
            workingDirectory,
          )
          .then(async (session) => {
            console.log(
              `[resume] Parallel execution session started: ${session.sessionId}`,
            );
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

      // タスクのステータスを in-progress に更新
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: "in-progress",
          startedAt: new Date(),
        },
      });
      console.log(`[resume] Updated task ${task.id} status to 'in-progress'`);

      // サブタスクがない場合は通常の再開
      orchestrator
        .resumeInterruptedExecution(executionId, {
          timeout: body?.timeout || 900000,
        })
        .then(async (result) => {
          if (result.success && !result.waitingForInput) {
            // タスクのステータスを完了に更新
            await prisma.task.update({
              where: { id: task.id },
              data: {
                status: "done",
                completedAt: new Date(),
              },
            });
            console.log(`[resume] Updated task ${task.id} status to 'done'`);

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
                  console.log(
                    `[agent-resume] Captured ${screenshots.length} screenshots for task ${task.id}: ${screenshots.map((s) => s.page).join(", ")}`,
                  );
                }
              } catch (screenshotErr) {
                console.warn(
                  "[agent-resume] Screenshot capture failed (non-fatal):",
                  screenshotErr,
                );
              }

              const screenshotData = sanitizeScreenshots(screenshots);
              const config = execution.session.config;
              if (config) {
                console.log(
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
            // 質問待ちの場合はタスクステータスを in-progress のまま維持
            console.log(
              `[resume] Task ${task.id} is waiting for input after resume`,
            );
          } else {
            // 失敗の場合はタスクステータスを todo に戻す
            await prisma.task.update({
              where: { id: task.id },
              data: { status: "todo" },
            });
            console.log(
              `[resume] Reverted task ${task.id} status to 'todo' due to failure`,
            );

            // セッションのステータスも失敗に更新
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
          console.error("[resume] Resume execution error:", error);

          // エラー時はタスクステータスを todo に戻す
          await prisma.task
            .update({
              where: { id: task.id },
              data: { status: "todo" },
            })
            .catch(() => {});
          console.log(
            `[resume] Reverted task ${task.id} status to 'todo' due to error`,
          );

          // セッションのステータスも失敗に更新
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
      console.error("[resume] Error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to resume execution",
      };
    }
  })

  // Reset execution state for a task (allows re-running)
  .post("/tasks/:id/reset-execution-state", async (context: any) => {
    const { params } = context;
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
        console.warn("[executing-tasks] Database unreachable, skipping");
      } else {
        console.error(
          "[executing-tasks] Error:",
          error instanceof Error ? error.message : String(error),
        );
      }
      return [];
    }
  })

  // Graceful shutdown endpoint (called by dev.js before stopping)
  .post("/agents/shutdown", async () => {
    try {
      console.log("[shutdown] Graceful shutdown requested via API");

      const activeCount = orchestrator.getActiveExecutionCount();

      // レスポンス送信後に即座にリスニングソケットを閉じ、その後エージェントを停止する
      // ポートを素早く解放することで、次回起動時のポート競合を防止
      setTimeout(async () => {
        try {
          // Step 1: SSE接続を全て閉じる（CLOSE_WAIT蓄積を防止）
          console.log("[shutdown] Closing all SSE connections...");
          realtimeService.shutdown();

          // Step 2: リスニングソケットを即座に閉じる（ポート解放を最優先）
          console.log(
            "[shutdown] Closing listening socket first for quick port release...",
          );
          await orchestrator.stopServer();
          console.log("[shutdown] Listening socket closed, port released.");

          // Step 3: エージェント停止とDB保存
          console.log("[shutdown] Stopping agents and saving state...");
          await orchestrator.gracefulShutdown({ skipServerStop: true });
          console.log("[shutdown] Agent shutdown completed.");
        } catch (error) {
          console.error("[shutdown] Graceful shutdown error:", error);
        } finally {
          // Step 4: プロセス終了
          console.log("[shutdown] Exiting process...");
          setTimeout(() => process.exit(0), 200);
        }
      }, 300); // レスポンス送信の時間を確保

      return {
        success: true,
        message: "Graceful shutdown initiated",
        activeExecutions: activeCount,
      };
    } catch (error) {
      console.error("[shutdown] Error:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to initiate shutdown",
      };
    }
  })

  // Continue execution with additional instruction
  .post("/tasks/:id/continue-execution", async (context) => {
    const taskId = parseInt(context.params.id);
    const { instruction, sessionId, agentConfigId } = context.body as any;

    if (!instruction?.trim()) {
      context.set.status = 400;
      return { error: "Instruction is required" };
    }

    try {
      // タスクと設定を取得
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          developerModeConfig: true,
          theme: true,
        },
      });

      if (!task) {
        context.set.status = 404;
        return { error: "Task not found" };
      }

      // セッションIDが指定されていない場合は最新の完了済みセッションを取得
      let targetSessionId = sessionId;
      if (!targetSessionId && task.developerModeConfig) {
        const latestSession = await prisma.agentSession.findFirst({
          where: {
            configId: task.developerModeConfig.id,
            status: "completed",
          },
          orderBy: { createdAt: "desc" },
        });

        if (latestSession) {
          targetSessionId = latestSession.id;
        }
      }

      if (!targetSessionId) {
        context.set.status = 404;
        return { error: "No completed session found for this task" };
      }

      // セッション情報を取得
      const session = await prisma.agentSession.findUnique({
        where: { id: targetSessionId },
        include: {
          agentExecutions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!session) {
        context.set.status = 404;
        return { error: "Session not found" };
      }

      if (session.status !== "completed") {
        context.set.status = 400;
        return { error: "Can only continue from completed sessions" };
      }

      // 前回の実行情報を取得
      const previousExecution = session.agentExecutions[0];
      const workingDirectory = task.theme?.workingDirectory || process.cwd();

      // セッションを再開状態に更新
      await prisma.agentSession.update({
        where: { id: targetSessionId },
        data: {
          status: "running",
          lastActivityAt: new Date(),
        },
      });

      // タスクのステータスを「進行中」に更新
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: "in-progress",
        },
      });

      console.log(
        `[continue-execution] Continuing execution for task ${taskId} in session ${targetSessionId}`,
      );

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "agent_execution_continued",
          title: "追加指示実行開始",
          message: `「${task.title}」に追加指示を実行しています`,
          link: `/tasks/${taskId}`,
          metadata: toJsonString({ sessionId: targetSessionId, taskId }),
        },
      });

      // 前回の実行ログを含めて新しい指示を作成
      let fullInstruction = `## 追加指示\n\n${instruction}`;

      // 前回の実行で生成したコードや変更内容を参考情報として含める
      if (previousExecution?.output) {
        const prevOutput = previousExecution.output.substring(0, 3000);
        fullInstruction = `## 前回の実行内容\n\n前回の実行で以下の作業を行いました：\n\n${prevOutput}${previousExecution.output.length > 3000 ? "\n...(省略)" : ""}\n\n${fullInstruction}`;
      }

      // オーケストレーターで実行（同じセッションで継続）
      orchestrator
        .executeTask(
          {
            id: taskId,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory,
          },
          {
            taskId,
            sessionId: targetSessionId,
            agentConfigId: agentConfigId || previousExecution?.agentConfigId,
            workingDirectory,
            continueFromPrevious: true, // 前回の実行からの継続であることを示すフラグ
          },
        )
        .then(async (result) => {
          if (result.success) {
            // タスクのステータスを「完了」に更新
            await prisma.task.update({
              where: { id: taskId },
              data: {
                status: "done",
                completedAt: new Date(),
              },
            });

            // セッションのステータスも完了に更新
            await prisma.agentSession.update({
              where: { id: targetSessionId },
              data: {
                status: "completed",
                completedAt: new Date(),
              },
            });

            // 差分を取得して承認リクエストを作成
            const diff = await orchestrator.getFullGitDiff(workingDirectory);
            const structuredDiff = await orchestrator.getDiff(workingDirectory);

            if (diff && diff !== "No changes detected") {
              const implementationSummary = cleanImplementationSummary(
                result.output || "追加指示の実装が完了しました。",
              );

              // スクリーンショットを撮影
              let screenshots: ScreenshotResult[] = [];
              try {
                screenshots = await captureScreenshotsForDiff(structuredDiff, {
                  workingDirectory,
                  agentOutput: result.output || "",
                });
              } catch (screenshotErr) {
                console.warn(
                  "[continue-execution] Screenshot capture failed:",
                  screenshotErr,
                );
              }

              const approvalRequest = await prisma.approvalRequest.create({
                data: {
                  configId: task.developerModeConfig!.id,
                  requestType: "code_review",
                  title: `「${task.title}」の追加変更レビュー`,
                  description: implementationSummary,
                  proposedChanges: toJsonString({
                    taskId,
                    sessionId: targetSessionId,
                    workingDirectory,
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: result.executionTimeMs,
                    screenshots: sanitizeScreenshots(screenshots),
                    isContinuation: true,
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
                  title: "追加変更のレビュー依頼",
                  message: `「${task.title}」の追加変更が完了しました。レビューをお願いします。`,
                  link: `/approvals/${approvalRequest.id}`,
                  metadata: toJsonString({
                    approvalRequestId: approvalRequest.id,
                    sessionId: targetSessionId,
                    taskId,
                  }),
                },
              });
            }
          } else {
            // 失敗時はタスクを未着手に戻す
            await prisma.task.update({
              where: { id: taskId },
              data: { status: "todo" },
            });

            // セッションも失敗状態に
            await prisma.agentSession.update({
              where: { id: targetSessionId },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: result.errorMessage || "Continuation failed",
              },
            });

            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "追加指示実行失敗",
                message: `「${task.title}」の追加指示実行が失敗しました: ${result.errorMessage}`,
                link: `/tasks/${taskId}`,
                metadata: toJsonString({
                  sessionId: targetSessionId,
                  taskId,
                }),
              },
            });
          }
        })
        .catch(async (error) => {
          console.error("[continue-execution] Error:", error);

          // エラー時もタスクを未着手に戻す
          await prisma.task
            .update({
              where: { id: taskId },
              data: { status: "todo" },
            })
            .catch(() => {});

          // セッションも失敗状態に
          await prisma.agentSession
            .update({
              where: { id: targetSessionId },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: error.message || "Continuation error",
              },
            })
            .catch(() => {});

          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "追加指示実行エラー",
              message: `「${task.title}」の追加指示実行中にエラーが発生しました`,
              link: `/tasks/${taskId}`,
            },
          });
        });

      return {
        success: true,
        sessionId: targetSessionId,
        taskId,
        workingDirectory,
        message:
          "追加指示の実行を開始しました。リアルタイムで進捗を確認できます。",
      };
    } catch (error) {
      console.error("[continue-execution] Error:", error);
      context.set.status = 500;
      return {
        error:
          error instanceof Error
            ? error.message
            : "Failed to continue execution",
      };
    }
  })

  // Server restart endpoint (called by frontend or dev tools)
  // Performs graceful shutdown then exits with code 75 to signal dev.js to restart
  .post("/agents/restart", async () => {
    try {
      console.log("[restart] Server restart requested via API");

      const activeCount = orchestrator.getActiveExecutionCount();

      // レスポンス送信後に即座にリスニングソケットを閉じ、その後エージェントを停止する
      setTimeout(async () => {
        try {
          // Step 1: SSE接続を全て閉じる（CLOSE_WAIT蓄積を防止）
          console.log("[restart] Closing all SSE connections...");
          realtimeService.shutdown();

          // Step 2: リスニングソケットを即座に閉じる（ポート解放を最優先）
          console.log(
            "[restart] Closing listening socket first for quick port release...",
          );
          await orchestrator.stopServer();
          console.log("[restart] Listening socket closed, port released.");

          // Step 3: エージェント停止とDB保存
          console.log("[restart] Stopping agents and saving state...");
          await orchestrator.gracefulShutdown({ skipServerStop: true });
          console.log("[restart] Agent shutdown completed.");
        } catch (error) {
          console.error("[restart] Graceful shutdown error:", error);
        } finally {
          // Step 4: 終了コード75でdev.jsに再起動を通知
          console.log("[restart] Exiting with restart code...");
          setTimeout(() => process.exit(75), 200);
        }
      }, 300); // レスポンス送信の時間を確保

      return {
        success: true,
        message:
          "Server restart initiated. Server will stop and restart automatically.",
        activeExecutions: activeCount,
      };
    } catch (error) {
      console.error("[restart] Error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to initiate restart",
      };
    }
  });
