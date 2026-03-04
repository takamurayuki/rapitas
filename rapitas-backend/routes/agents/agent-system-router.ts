/**
 * Agent System Router
 * 診断・システム状態・暗号化・シャットダウン機能
 */
import { Elysia } from "elysia";
import { prisma } from "../../config/database";
import { orchestrator } from "./approvals";
import { isEncryptionKeyConfigured } from "../../utils/encryption";
import { getAllAgentConfigSchemas } from "../../utils/agent-config-schema";
import { realtimeService } from "../../services/realtime-service";

export const agentSystemRouter = new Elysia({ prefix: "/agents" })

  // Get encryption configuration status
  .get("/encryption-status", async () => {
    return {
      isConfigured: isEncryptionKeyConfigured(),
      message: isEncryptionKeyConfigured()
        ? "暗号化キーが正しく設定されています"
        : "警告: 暗号化キーが環境変数に設定されていません。本番環境では必ず設定してください。",
    };
  })

  // Get all agent configuration schemas
  .get("/config-schemas", async () => {
    return {
      schemas: getAllAgentConfigSchemas(),
    };
  })

  // Claude CLI diagnosis endpoint
  .get("/diagnose", async () => {
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

  // Get system status (including shutdown state)
  .get("/system-status", async () => {
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

    // システムステータスの判定
    let status = "healthy";
    if (isShuttingDown) status = "shutting_down";
    else if (activeExecutions > 0) status = "busy";
    else if (interruptedExecutions > 0) status = "interrupted_executions";

    return {
      status,
      isShuttingDown,
      activeExecutions,
      runningExecutions,
      interruptedExecutions,
      serverTime: new Date().toISOString(),
    };
  })

  // Validate agent configuration
  .get("/validate-config", async () => {
    try {
      // エージェント設定の基本的なバリデーション
      const agentConfigs = await prisma.aIAgentConfig.findMany({
        select: {
          id: true,
          name: true,
          agentType: true,
          isActive: true,
        },
      });

      let isValid = true;
      const errors: string[] = [];

      // 最低1つのアクティブなエージェントが必要
      const activeConfigs = agentConfigs.filter((config) => config.isActive);
      if (activeConfigs.length === 0) {
        isValid = false;
        errors.push("No active agent configurations found");
      }

      // 暗号化キー設定の確認
      if (!isEncryptionKeyConfigured()) {
        isValid = false;
        errors.push("Encryption key not configured");
      }

      return {
        isValid,
        totalConfigs: agentConfigs.length,
        activeConfigs: activeConfigs.length,
        errors,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [
          `Validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        timestamp: new Date().toISOString(),
      };
    }
  })

  // Health check endpoint
  .get("/health", async () => {
    try {
      // データベース接続確認
      await prisma.$queryRaw`SELECT 1`;

      return {
        status: "healthy",
        database: "connected",
        encryption: isEncryptionKeyConfigured()
          ? "configured"
          : "not_configured",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return Response.json(
        {
          status: "unhealthy",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }
  })

  // Graceful shutdown endpoint (called by dev.js before stopping)
  .post("/shutdown", async () => {
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

  // Server restart endpoint (called by frontend or dev tools)
  // Performs graceful shutdown then exits with code 75 to signal dev.js to restart
  .post("/restart", async () => {
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
