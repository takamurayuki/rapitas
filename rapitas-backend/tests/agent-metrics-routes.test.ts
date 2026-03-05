/**
 * Agent Metrics Router テスト
 * エージェントメトリクス（一覧・概要・トレンド・性能比較・詳細）のテスト
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Elysia } from "elysia";

const mockFindMany = mock(() => Promise.resolve([]));
const mockCount = mock(() => Promise.resolve(0));
const mockFindUnique = mock(() => Promise.resolve(null));
const mockExecutionFindMany = mock(() => Promise.resolve([]));

mock.module("@prisma/client", () => ({
  PrismaClient: class {
    aIAgentConfig = {
      findMany: mockFindMany,
      count: mockCount,
      findUnique: mockFindUnique,
    };
    agentExecution = {
      findMany: mockExecutionFindMany,
    };
  },
  Prisma: { validator: () => ({}) },
}));

mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { agentMetricsRouter } = await import(
  "../routes/agents/agent-metrics"
);

describe("Agent Metrics Router", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(() => {
    mockFindMany.mockReset();
    mockCount.mockReset();
    mockFindUnique.mockReset();
    mockExecutionFindMany.mockReset();

    // Set default mock responses
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockFindUnique.mockResolvedValue(null);
    mockExecutionFindMany.mockResolvedValue([]);

    app = new Elysia().use(agentMetricsRouter);
  });

  describe("GET /agent-metrics/", () => {
    it("should return metrics list", async () => {
      mockFindMany.mockResolvedValue([]);

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.metrics).toBeDefined();
      expect(Array.isArray(data.metrics)).toBe(true);
    });

    it("should return metrics with agent data", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          name: "Test Agent",
          agentType: "claude-code",
          modelId: "claude-3",
          isActive: true,
          executions: [
            {
              id: 1,
              status: "completed",
              tokensUsed: 100,
              executionTimeMs: 5000,
              completedAt: new Date(),
              startedAt: new Date(),
              errorMessage: null,
            },
          ],
        },
      ]);

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.metrics).toBeDefined();
      expect(data.metrics.length).toBe(1);
      expect(data.metrics[0].agentName).toBe("Test Agent");
      expect(data.metrics[0].totalExecutions).toBe(1);
      expect(data.metrics[0].successfulExecutions).toBe(1);
    });
  });

  describe("GET /agent-metrics/overview", () => {
    it("should return overview object", async () => {
      mockExecutionFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/overview")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.totalExecutions).toBeDefined();
      expect(data.totalSuccessful).toBeDefined();
      expect(data.totalFailed).toBeDefined();
      expect(data.overallSuccessRate).toBeDefined();
      expect(data.totalTokensUsed).toBeDefined();
      expect(data.totalAgents).toBeDefined();
      expect(data.activeAgents).toBeDefined();
      expect(data.averageExecutionTime).toBeDefined();
    });
  });

  describe("GET /agent-metrics/trends", () => {
    it("should return trends array", async () => {
      mockExecutionFindMany.mockResolvedValue([]);

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/trends")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.trends).toBeDefined();
      expect(Array.isArray(data.trends)).toBe(true);
    });
  });

  describe("GET /agent-metrics/performance", () => {
    it("should return performance array", async () => {
      mockExecutionFindMany.mockResolvedValue([]);

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/performance")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.performance).toBeDefined();
      expect(Array.isArray(data.performance)).toBe(true);
    });
  });

  describe("GET /agent-metrics/:agentId", () => {
    it("should return error when agent not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/1")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should return agent detail metrics when found", async () => {
      mockFindUnique.mockResolvedValue({
        id: 1,
        name: "Test Agent",
        agentType: "claude-code",
        modelId: "claude-3",
        isActive: true,
        executions: [
          {
            id: 1,
            status: "completed",
            tokensUsed: 200,
            executionTimeMs: 3000,
            completedAt: new Date(),
            startedAt: new Date(),
            errorMessage: null,
            command: "test command",
            executionLogs: [],
          },
        ],
      });

      const response = await app.handle(
        new Request("http://localhost/agent-metrics/1")
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.agent).toBeDefined();
      expect(data.agent.id).toBe(1);
      expect(data.metrics).toBeDefined();
      expect(data.metrics.totalExecutions).toBe(1);
      expect(data.recentExecutions).toBeDefined();
      expect(Array.isArray(data.recentExecutions)).toBe(true);
    });
  });
});
