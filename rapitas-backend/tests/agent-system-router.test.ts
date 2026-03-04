/**
 * Agent System Router テスト
 * システム・診断機能（暗号化、診断、シャットダウン、再起動）のテスト
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Elysia } from "elysia";
import { agentSystemRouter } from "../routes/agents/agent-system-router";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  const originalExit = process.exit;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    // Mock process.exit to prevent shutdown/restart endpoints from killing the test runner
    const mockExit = mock(() => {});
    process.exit = mockExit as unknown as typeof process.exit;

    // Mock setTimeout to prevent delayed process.exit calls
    global.setTimeout = mock((callback: (...args: any[]) => void, delay: number, ...args: any[]) => {
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
        .handle(new Request("http://localhost/agents/diagnose"))
        .then((res: Response) => res.json()) as Record<string, unknown>;

      expect(response).toBeDefined();
      expect(typeof response).toBe("object");
    });
  });

  describe("GET /agents/system-status", () => {
    it("should return system status", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/system-status"))
        .then((res: Response) => res.json()) as SystemStatusResponse;

      expect(response).toBeDefined();
      expect(typeof response.status).toBe("string");
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