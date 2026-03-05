/**
 * Agent Registry テスト
 * プロバイダーとエージェントの登録・管理を検証
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { IAgentProvider } from "../services/agents/abstraction/interfaces";
import type { AgentProviderId, AgentProviderConfig } from "../services/agents/abstraction/types";

mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { AgentRegistry } = await import(
  "../services/agents/abstraction/registry"
);

// モックプロバイダー作成ヘルパー
function createMockProvider(
  id: string,
  capabilities: Record<string, boolean> = {},
  options: {
    isAvailable?: boolean;
    healthy?: boolean;
    latency?: number;
  } = {}
): IAgentProvider {
  const { isAvailable = true, healthy = true, latency = 100 } = options;

  return {
    providerId: id,
    providerName: `Mock ${id}`,
    version: "1.0.0",
    getCapabilities: () => ({
      codeGeneration: false,
      codeReview: false,
      codeExecution: false,
      fileRead: false,
      fileWrite: false,
      fileEdit: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
      webFetch: false,
      taskAnalysis: false,
      taskPlanning: false,
      parallelExecution: false,
      questionAsking: false,
      conversationMemory: false,
      sessionContinuation: false,
      ...capabilities,
    }),
    isAvailable: mock(() => Promise.resolve(isAvailable)),
    validateConfig: mock(() => Promise.resolve({ valid: true, errors: [] })),
    healthCheck: mock(() =>
      Promise.resolve({
        healthy,
        available: isAvailable,
        latency,
        lastCheck: new Date(),
      })
    ),
    createAgent: mock(() => {
      const uniqueId = `agent-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        metadata: {
          id: uniqueId,
          providerId: id,
          name: `Agent ${id}`,
        },
        state: "idle",
        dispose: mock(() => Promise.resolve()),
      };
    }),
    dispose: mock(() => Promise.resolve()),
  };
}

describe("AgentRegistry", () => {
  let registry: InstanceType<typeof AgentRegistry>;

  beforeEach(() => {
    AgentRegistry.resetInstance();
    registry = AgentRegistry.getInstance();
  });

  describe("シングルトン", () => {
    test("getInstanceが同じインスタンスを返すこと", () => {
      const a = AgentRegistry.getInstance();
      const b = AgentRegistry.getInstance();
      expect(a).toBe(b);
    });

    test("resetInstanceでインスタンスがリセットされること", () => {
      const before = AgentRegistry.getInstance();
      AgentRegistry.resetInstance();
      const after = AgentRegistry.getInstance();
      expect(before).not.toBe(after);
    });
  });

  describe("プロバイダー管理", () => {
    test("registerProviderでプロバイダーを登録できること", () => {
      const provider = createMockProvider("claude-code");
      registry.registerProvider(provider);

      expect(registry.getProvider("claude-code" as AgentProviderId)).toBe(provider);
    });

    test("getAllProvidersで全プロバイダーを取得できること", () => {
      registry.registerProvider(createMockProvider("claude-code"));
      registry.registerProvider(createMockProvider("gemini"));

      expect(registry.getAllProviders()).toHaveLength(2);
    });

    test("unregisterProviderでプロバイダーを削除できること", () => {
      registry.registerProvider(createMockProvider("claude-code"));
      const result = registry.unregisterProvider("claude-code" as AgentProviderId);

      expect(result).toBe(true);
      expect(registry.getProvider("claude-code" as AgentProviderId)).toBeUndefined();
    });

    test("unregisterProvider時に関連エージェントがdisposeされること", async () => {
      const provider = createMockProvider("claude-code");
      registry.registerProvider(provider);

      const agent = registry.createAgent({
        providerId: "claude-code",
      } as AgentProviderConfig);

      registry.unregisterProvider("claude-code" as AgentProviderId);

      expect(agent.dispose).toHaveBeenCalled();
    });

    test("重複登録で警告が出ること（上書き）", () => {
      const provider1 = createMockProvider("claude-code");
      const provider2 = createMockProvider("claude-code");

      registry.registerProvider(provider1);
      registry.registerProvider(provider2);

      expect(registry.getProvider("claude-code" as AgentProviderId)).toBe(provider2);
    });
  });

  describe("能力ベースフィルタ", () => {
    test("getProvidersByCapabilityで特定能力のプロバイダーを取得すること", () => {
      registry.registerProvider(
        createMockProvider("p1", { codeGeneration: true })
      );
      registry.registerProvider(
        createMockProvider("p2", { codeGeneration: false })
      );
      registry.registerProvider(
        createMockProvider("p3", { codeGeneration: true })
      );

      const result = registry.getProvidersByCapability("codeGeneration");
      expect(result).toHaveLength(2);
    });
  });

  describe("エージェント管理", () => {
    test("createAgentでエージェントを作成できること", () => {
      registry.registerProvider(createMockProvider("claude-code"));

      const agent = registry.createAgent({
        providerId: "claude-code",
      } as AgentProviderConfig);

      expect(agent).toBeDefined();
      expect(agent.metadata.providerId).toBe("claude-code");
    });

    test("存在しないプロバイダーでエラーを投げること", () => {
      expect(() =>
        registry.createAgent({ providerId: "unknown" } as AgentProviderConfig)
      ).toThrow("Provider 'unknown' not found");
    });

    test("getAgentでエージェントを取得できること", () => {
      registry.registerProvider(createMockProvider("claude-code"));
      const agent = registry.createAgent({
        providerId: "claude-code",
      } as AgentProviderConfig);

      const retrieved = registry.getAgent(agent.metadata.id);
      expect(retrieved).toBe(agent);
    });

    test("getAgentsByProviderでプロバイダー別エージェントを取得すること", () => {
      registry.registerProvider(createMockProvider("claude-code"));
      registry.registerProvider(createMockProvider("gemini"));

      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);
      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);
      registry.createAgent({ providerId: "gemini" } as AgentProviderConfig);

      expect(registry.getAgentsByProvider("claude-code" as AgentProviderId)).toHaveLength(2);
      expect(registry.getAgentsByProvider("gemini" as AgentProviderId)).toHaveLength(1);
    });

    test("disposeAgentでエージェントを解放できること", async () => {
      registry.registerProvider(createMockProvider("claude-code"));
      const agent = registry.createAgent({
        providerId: "claude-code",
      } as AgentProviderConfig);

      await registry.disposeAgent(agent.metadata.id);

      expect(registry.getAgent(agent.metadata.id)).toBeUndefined();
      expect(agent.dispose).toHaveBeenCalled();
    });

    test("disposeAllAgentsで全エージェントを解放すること", async () => {
      registry.registerProvider(createMockProvider("claude-code"));
      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);
      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);

      await registry.disposeAllAgents();

      expect(registry.getAllAgents().size).toBe(0);
    });
  });

  describe("最適プロバイダー選択", () => {
    test("必須能力を持つプロバイダーを返すこと", async () => {
      registry.registerProvider(
        createMockProvider("p1", {
          codeGeneration: true,
          fileWrite: true,
        })
      );
      registry.registerProvider(
        createMockProvider("p2", {
          codeGeneration: true,
          fileWrite: false,
        })
      );

      const best = await registry.selectBestProvider([
        "codeGeneration",
        "fileWrite",
      ]);
      expect(best).not.toBeNull();
      expect(best!.providerId).toBe("p1");
    });

    test("候補がない場合nullを返すこと", async () => {
      registry.registerProvider(
        createMockProvider("p1", { codeGeneration: false })
      );

      const best = await registry.selectBestProvider(["codeGeneration"]);
      expect(best).toBeNull();
    });

    test("利用不可なプロバイダーを除外すること", async () => {
      registry.registerProvider(
        createMockProvider("p1", { codeGeneration: true }, {
          isAvailable: false,
        })
      );
      registry.registerProvider(
        createMockProvider("p2", { codeGeneration: true }, {
          isAvailable: true,
        })
      );

      const best = await registry.selectBestProvider(["codeGeneration"]);
      expect(best!.providerId).toBe("p2");
    });

    test("healthyでないプロバイダーを除外すること", async () => {
      registry.registerProvider(
        createMockProvider("p1", { codeGeneration: true }, {
          healthy: false,
        })
      );

      const best = await registry.selectBestProvider(["codeGeneration"]);
      expect(best).toBeNull();
    });

    test("レイテンシの低いプロバイダーが優先されること", async () => {
      registry.registerProvider(
        createMockProvider("slow", { codeGeneration: true }, {
          latency: 800,
        })
      );
      registry.registerProvider(
        createMockProvider("fast", { codeGeneration: true }, {
          latency: 50,
        })
      );

      const best = await registry.selectBestProvider(["codeGeneration"]);
      expect(best!.providerId).toBe("fast");
    });
  });

  describe("アイドルエージェントクリーンアップ", () => {
    test("アイドル状態のエージェントを削除すること", async () => {
      const provider = createMockProvider("claude-code");
      const idleTime = 10000; // 10秒

      // lastUsedAtが古いエージェントを作成
      provider.createAgent = mock(() => ({
        metadata: {
          id: `idle-agent-${Date.now()}`,
          providerId: "claude-code",
          name: "idle",
          lastUsedAt: new Date(Date.now() - 20000), // 20秒前
        },
        state: "idle",
        dispose: mock(() => Promise.resolve()),
      }));

      registry.registerProvider(provider);
      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);

      const removed = await registry.cleanupIdleAgents(idleTime);
      expect(removed).toBe(1);
    });

    test("実行中のエージェントは削除しないこと", async () => {
      const provider = createMockProvider("claude-code");
      provider.createAgent = mock(() => ({
        metadata: {
          id: `running-agent`,
          providerId: "claude-code",
          name: "running",
          lastUsedAt: new Date(Date.now() - 999999),
        },
        state: "running", // 実行中
        dispose: mock(() => Promise.resolve()),
      }));

      registry.registerProvider(provider);
      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);

      const removed = await registry.cleanupIdleAgents(1000);
      expect(removed).toBe(0);
    });
  });

  describe("ヘルスチェック", () => {
    test("healthCheckAllが全プロバイダーのステータスを返すこと", async () => {
      registry.registerProvider(createMockProvider("p1"));
      registry.registerProvider(createMockProvider("p2"));

      const results = await registry.healthCheckAll();
      expect(results.size).toBe(2);
      expect(results.get("p1" as AgentProviderId)!.healthy).toBe(true);
    });

    test("ヘルスチェック失敗時にエラー情報を返すこと", async () => {
      const provider = createMockProvider("failing");
      provider.healthCheck = mock(() =>
        Promise.reject(new Error("Connection refused"))
      );

      registry.registerProvider(provider);

      const results = await registry.healthCheckAll();
      const status = results.get("failing" as AgentProviderId)!;
      expect(status.healthy).toBe(false);
      expect(status.errors).toContain("Connection refused");
    });
  });

  describe("統計情報", () => {
    test("getStatsでプロバイダー/エージェント数を返すこと", () => {
      registry.registerProvider(createMockProvider("claude-code"));
      registry.registerProvider(createMockProvider("gemini"));
      registry.createAgent({ providerId: "claude-code" } as AgentProviderConfig);

      const stats = registry.getStats();
      expect(stats.providerCount).toBe(2);
      expect(stats.agentCount).toBe(1);
      expect(stats.agentsByProvider["claude-code"]).toBe(1);
      expect(stats.agentsByState["idle"]).toBe(1);
    });

    test("エージェントがない場合空の統計を返すこと", () => {
      const stats = registry.getStats();
      expect(stats.providerCount).toBe(0);
      expect(stats.agentCount).toBe(0);
    });
  });
});
