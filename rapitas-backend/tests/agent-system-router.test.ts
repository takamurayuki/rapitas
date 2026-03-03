/**
 * Agent System Router テスト
 * システム・診断機能（暗号化、診断、シャットダウン、再起動）のテスト
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { agentSystemRouter } from "../routes/agents/agent-system-router";

describe("Agent System Router", () => {
  let app: Elysia;

  beforeEach(() => {
    app = new Elysia().use(agentSystemRouter);
  });

  describe("GET /agents/encryption-status", () => {
    it("should return encryption status", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/encryption-status"))
        .then(res => res.json());

      expect(response).toBeDefined();
      expect(typeof response.isConfigured).toBe("boolean");
    });
  });

  describe("GET /agents/diagnose", () => {
    it("should return system diagnosis", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/diagnose"))
        .then(res => res.json());

      expect(response).toBeDefined();
      expect(typeof response).toBe("object");
    });
  });

  describe("GET /agents/system-status", () => {
    it("should return system status", async () => {
      const response = await app
        .handle(new Request("http://localhost/agents/system-status"))
        .then(res => res.json());

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
        .then(res => res.json());

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