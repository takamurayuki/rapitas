/**
 * Agent System Router テスト
 * システム・診断機能（暗号化、診断、シャットダウン、再起動）のテスト
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  aIAgentConfig: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  agentExecution: {
    count: mock(() => Promise.resolve(0)),
  },
  $queryRaw: mock(() => Promise.resolve([1])),
};

const mockOrchestrator = {
  shutdown: mock(() => Promise.resolve()),
  restart: mock(() => Promise.resolve()),
  getActiveExecutionCount: mock(() => 0),
  isInShutdown: mock(() => false),
};

const mockRealtimeService = {
  broadcast: mock(() => {}),
  getConnectedClients: mock(() => 0),
};

// Mock modules
mock.module("../../../config/database", () => ({ prisma: mockPrisma }));
mock.module("../../../routes/agents/approvals", () => ({ orchestrator: mockOrchestrator }));
mock.module("../../../utils/encryption", () => ({
  isEncryptionKeyConfigured: mock(() => true),
}));
mock.module("../../../utils/agent-config-schema", () => ({
  getAllAgentConfigSchemas: mock(() => ({})),
}));
mock.module("../../../services/realtime-service", () => ({
  realtimeService: mockRealtimeService,
}));
mock.module("../../../config/logger", () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  })),
}));

// Mock child_process for diagnose endpoint
mock.module("child_process", () => ({
  spawn: mock(() => ({
    stdout: { on: mock(() => {}) },
    stderr: { on: mock(() => {}) },
    kill: mock(() => {}),
    on: mock((event, callback) => {
      if (event === "close") setTimeout(() => callback(0), 100);
    }),
  })),
}));

const { agentSystemRouter } = await import("../../../routes/agents/agent-system-router");

interface EncryptionStatusResponse {
  isConfigured: boolean;
  [key: string]: unknown;
}

interface SystemStatusResponse {
  status: string;
  [key: string]: unknown;
}

interface ValidateConfigResponse {
  isValid: boolean;
  [key: string]: unknown;
}

describe("Agent System Router", () => {
  let app: Elysia;
  const originalExit = process.exit;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    // Mock process.exit to prevent shutdown/restart endpoints from killing the test runner
    const mockExit = mock(() => {});
    process.exit = mockExit as unknown as typeof process.exit;

    // Mock setTimeout to prevent delayed process.exit calls
    global.setTimeout = mock((callback: () => void, delay: number, ...args: unknown[]) => {
      // Check if the callback contains process.exit, if so don't execute it
      const callbackStr = callback.toString();
      if (callbackStr.includes('process.exit')) {
        return 0; // Return a dummy timer ID
      }
      // For non-process.exit callbacks, execute immediately for faster tests
      return originalSetTimeout(callback, 0, ...args);
    }) as unknown as typeof setTimeout;

    app = new Elysia().use(agentSystemRouter);
  });

  afterEach(() => {
    process.exit = originalExit;
    global.setTimeout = originalSetTimeout;
  });

  describe("GET /agents/encryption-status", () => {
    it("should return encryption status", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/encryption-status"))
        .then((res: Response) => res.json()) as EncryptionStatusResponse;

      expect(response).toBeDefined();
      expect(typeof response.isConfigured).toBe("boolean");
    });
  });

  describe("GET /agents/diagnose", () => {
    it("should return system diagnosis", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/diagnose"));

      expect(response.status).toBe(200);
      const data = await response.json() as Record<string, unknown>;
      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
    });
  });

  describe("GET /agents/system-status", () => {
    it("should return system status", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/system-status"));

      expect(response.status).toBe(200);
      const data = await response.json() as SystemStatusResponse;
      expect(data).toBeDefined();
      expect(typeof data.status).toBe("string");
    });
  });

  describe("POST /agents/shutdown", () => {
    it("should handle shutdown request", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/shutdown", {
          method: "POST"
        }));

      expect(response.status).toBeOneOf([200, 202]);
    });
  });

  describe("POST /agents/restart", () => {
    it("should handle restart request", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/restart", {
          method: "POST"
        }));

      expect(response.status).toBeOneOf([200, 202]);
    });
  });

  describe("GET /agents/validate-config", () => {
    it("should validate agent configuration", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/validate-config"))
        .then((res: Response) => res.json()) as ValidateConfigResponse;

      expect(response).toBeDefined();
      expect(typeof response.isValid).toBe("boolean");
    });
  });

  describe("GET /agents/health", () => {
    it("should return health status", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/health"));

      expect(response.status).toBe(200);
    });
  });
});