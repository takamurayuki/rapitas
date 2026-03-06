/**
 * Approvals Routes テスト
 * 承認APIのテスト
 */
import { describe, test, expect, mock } from "bun:test";

mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const mockApproval = {
  id: 1,
  configId: 1,
  requestType: "subtask_creation",
  title: "テスト承認",
  description: "テスト",
  proposedChanges: JSON.stringify({ subtasks: [] }),
  estimatedChanges: null,
  status: "pending",
  createdAt: new Date(),
  config: {
    task: {
      id: 1,
      title: "Test",
      theme: { defaultBranch: "main", workingDirectory: "/tmp" },
    },
  },
};

const mockPrisma = {
  approvalRequest: {
    findMany: mock(() => Promise.resolve([mockApproval])),
    findUnique: mock(() => Promise.resolve(mockApproval)),
    update: mock(() => Promise.resolve({ ...mockApproval, status: "approved" })),
  },
  task: {
    create: mock(() => Promise.resolve({ id: 2, title: "New Subtask" })),
    findUnique: mock(() => Promise.resolve({ id: 1, title: "Test" })),
  },
  developerModeConfig: {
    findUnique: mock(() => Promise.resolve({ id: 1, taskId: 1 })),
  },
  agentSession: {
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({ id: 1 })),
  },
  agentAction: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  notification: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  agentExecution: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  $transaction: mock((fn: Function) => fn(mockPrisma)),
};

mock.module("../config/database", () => ({ prisma: mockPrisma }));

mock.module("../services/agents/agent-orchestrator", () => ({
  createOrchestrator: mock(() => ({
    addEventListener: mock(() => {}),
    executeTask: mock(() => Promise.resolve()),
    cancelExecution: mock(() => Promise.resolve()),
  })),
}));

mock.module("../services/github-service", () => ({
  GitHubService: class {
    constructor() {}
    createPR() { return Promise.resolve({ url: "http://github.com/pr/1" }); }
  },
}));

mock.module("../services/realtime-service", () => ({
  realtimeService: {
    broadcast: mock(() => {}),
  },
}));

mock.module("../utils/db-helpers", () => ({
  toJsonString: mock((v: unknown) => JSON.stringify(v)),
  fromJsonString: mock((v: string) => {
    try { return JSON.parse(v); } catch { return null; }
  }),
}));

mock.module("../services/screenshot-service", () => ({
  captureScreenshotsForDiff: mock(() => Promise.resolve([])),
}));

const { approvalsRoutes } = await import("../routes/agents/approvals");

import { Elysia } from "elysia";
const app = new Elysia().use(approvalsRoutes);

describe("Approvals Routes", () => {
  test("GET /approvals/ - 承認リスト取得", async () => {
    const res = await app.handle(
      new Request("http://localhost/approvals/")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /approvals/:id - 承認詳細取得", async () => {
    const res = await app.handle(
      new Request("http://localhost/approvals/1")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("GET /approvals/:id - 存在しない場合", async () => {
    mockPrisma.approvalRequest.findUnique.mockImplementationOnce(() =>
      Promise.resolve(null)
    );
    const res = await app.handle(
      new Request("http://localhost/approvals/999")
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // null or empty response when not found
    expect(text === "null" || text === "").toBe(true);
  });
});
