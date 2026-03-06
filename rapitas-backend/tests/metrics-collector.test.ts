import { describe, test, expect, beforeEach } from "bun:test";
import {
  DefaultMetricsCollector,
  getDefaultMetricsCollector,
  setDefaultMetricsCollector,
} from "../services/agents/abstraction/metrics-collector";

describe("DefaultMetricsCollector", () => {
  let collector: DefaultMetricsCollector;

  beforeEach(() => {
    collector = new DefaultMetricsCollector();
  });

  describe("実行ライフサイクル", () => {
    test("startExecutionでエントリーが作成されること", () => {
      collector.startExecution("exec-1", "agent-1");
      const metrics = collector.getMetrics("exec-1");
      expect(metrics).not.toBeNull();
      expect(metrics!.durationMs).toBeGreaterThanOrEqual(0);
      expect(metrics!.tokensUsed).toEqual({ input: 0, output: 0 });
      expect(metrics!.toolCalls).toBe(0);
      expect(metrics!.fileChanges).toEqual({ added: 0, deleted: 0 });
      expect(metrics!.costUsd).toBe(0);
    });

    test("endExecutionで終了時刻とsuccessが設定されること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.endExecution("exec-1", true);
      const metrics = collector.getMetrics("exec-1");
      expect(metrics).not.toBeNull();
      expect(metrics!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("存在しないexecutionIdでnullを返すこと", () => {
      expect(collector.getMetrics("unknown")).toBeNull();
    });
  });

  describe("データ記録", () => {
    test("recordTokenUsageでトークンが蓄積されること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordTokenUsage("exec-1", 100, 50);
      collector.recordTokenUsage("exec-1", 200, 100);

      const metrics = collector.getMetrics("exec-1");
      expect(metrics!.tokensUsed).toEqual({ input: 300, output: 150 });
    });

    test("recordToolCallでツール呼び出しがカウントされること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordToolCall("exec-1", "read", 100, true);
      collector.recordToolCall("exec-1", "write", 200, false);

      const metrics = collector.getMetrics("exec-1");
      expect(metrics!.toolCalls).toBe(2);
    });

    test("recordFileChangeでファイル変更が蓄積されること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordFileChange("exec-1", 5, 2);
      collector.recordFileChange("exec-1", 3, 1);

      const metrics = collector.getMetrics("exec-1");
      expect(metrics!.fileChanges).toEqual({ added: 8, deleted: 3 });
    });

    test("recordCostでコストが蓄積されること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordCost("exec-1", 0.01);
      collector.recordCost("exec-1", 0.02);

      const metrics = collector.getMetrics("exec-1");
      expect(metrics!.costUsd).toBeCloseTo(0.03);
    });

    test("存在しないexecutionIdへの記録は無視されること", () => {
      collector.recordTokenUsage("unknown", 100, 50);
      collector.recordToolCall("unknown", "read", 100, true);
      collector.recordFileChange("unknown", 5, 2);
      collector.recordCost("unknown", 0.01);
      expect(collector.getMetrics("unknown")).toBeNull();
    });
  });

  describe("集計メトリクス", () => {
    test("getAggregateMetricsでエージェント別集計ができること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordTokenUsage("exec-1", 100, 50);
      collector.recordCost("exec-1", 0.01);
      collector.endExecution("exec-1", true);

      collector.startExecution("exec-2", "agent-1");
      collector.recordTokenUsage("exec-2", 200, 100);
      collector.recordCost("exec-2", 0.02);
      collector.endExecution("exec-2", false);

      const agg = collector.getAggregateMetrics("agent-1", "day");
      expect(agg.totalExecutions).toBe(2);
      expect(agg.successRate).toBe(0.5);
      expect(agg.totalTokens).toBe(450);
      expect(agg.totalCostUsd).toBeCloseTo(0.03);
    });

    test("履歴がない場合ゼロ値を返すこと", () => {
      const agg = collector.getAggregateMetrics("unknown-agent", "day");
      expect(agg.totalExecutions).toBe(0);
      expect(agg.successRate).toBe(0);
      expect(agg.avgDurationMs).toBe(0);
    });
  });

  describe("全体統計", () => {
    test("getGlobalStatsで全体の統計を返すこと", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordTokenUsage("exec-1", 100, 50);
      collector.endExecution("exec-1", true);

      collector.startExecution("exec-2", "agent-2");
      collector.recordTokenUsage("exec-2", 200, 100);
      // exec-2はまだ実行中

      const stats = collector.getGlobalStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.activeExecutions).toBe(1);
      expect(stats.totalTokens).toBe(450);
      expect(stats.byAgent.size).toBe(2);
    });

    test("エージェント別統計が含まれること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.endExecution("exec-1", true);

      collector.startExecution("exec-2", "agent-1");
      collector.endExecution("exec-2", true);

      const stats = collector.getGlobalStats();
      const agentStats = stats.byAgent.get("agent-1");
      expect(agentStats).toBeDefined();
      expect(agentStats!.totalExecutions).toBe(2);
      expect(agentStats!.successfulExecutions).toBe(2);
      expect(agentStats!.successRate).toBe(1);
    });
  });

  describe("ツール呼び出し統計", () => {
    test("getToolCallStatsでツール別統計を返すこと", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordToolCall("exec-1", "read", 100, true);
      collector.recordToolCall("exec-1", "read", 150, true);
      collector.recordToolCall("exec-1", "write", 200, false);

      const stats = collector.getToolCallStats();
      const readStats = stats.get("read");
      expect(readStats).toBeDefined();
      expect(readStats!.count).toBe(2);
      expect(readStats!.avgDurationMs).toBe(125);
      expect(readStats!.successRate).toBe(1);

      const writeStats = stats.get("write");
      expect(writeStats!.count).toBe(1);
      expect(writeStats!.successRate).toBe(0);
    });

    test("エージェントIDでフィルタできること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.recordToolCall("exec-1", "read", 100, true);

      collector.startExecution("exec-2", "agent-2");
      collector.recordToolCall("exec-2", "write", 200, true);

      const stats = collector.getToolCallStats("agent-1");
      expect(stats.size).toBe(1);
      expect(stats.has("read")).toBe(true);
      expect(stats.has("write")).toBe(false);
    });
  });

  describe("履歴管理", () => {
    test("pruneHistoryで上限を超えた履歴が削除されること", () => {
      const smallCollector = new DefaultMetricsCollector({
        maxHistorySize: 3,
      });

      for (let i = 0; i < 5; i++) {
        smallCollector.startExecution(`exec-${i}`, "agent-1");
      }

      // 最初の2つは削除されているはず
      expect(smallCollector.getMetrics("exec-0")).toBeNull();
      expect(smallCollector.getMetrics("exec-1")).toBeNull();
      expect(smallCollector.getMetrics("exec-2")).not.toBeNull();
      expect(smallCollector.getMetrics("exec-4")).not.toBeNull();
    });

    test("clearで全データがクリアされること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.clear();

      expect(collector.getMetrics("exec-1")).toBeNull();
      const stats = collector.getGlobalStats();
      expect(stats.totalExecutions).toBe(0);
    });

    test("clearAgentで特定エージェントのデータのみ削除されること", () => {
      collector.startExecution("exec-1", "agent-1");
      collector.startExecution("exec-2", "agent-2");

      collector.clearAgent("agent-1");

      expect(collector.getMetrics("exec-1")).toBeNull();
      expect(collector.getMetrics("exec-2")).not.toBeNull();
    });
  });

  describe("シングルトン", () => {
    test("getDefaultMetricsCollectorが同じインスタンスを返すこと", () => {
      const a = getDefaultMetricsCollector();
      const b = getDefaultMetricsCollector();
      expect(a).toBe(b);
    });

    test("setDefaultMetricsCollectorでインスタンスを差し替えられること", () => {
      const custom = new DefaultMetricsCollector();
      setDefaultMetricsCollector(custom);
      expect(getDefaultMetricsCollector()).toBe(custom);
    });
  });
});
