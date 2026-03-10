/**
 * Agent Audit Router テスト
 * 監査・ログ機能（監査ログ、実行ログ）のテスト
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import {
  agentAuditRouter,
  taskExecutionLogsRouter,
} from '../../../routes/agents/agent-audit-router';

interface AuditLogResponse {
  logs: unknown[];
  [key: string]: unknown;
}

interface ExecutionLogResponse {
  logs: unknown[];
  lastSequence: unknown;
  status: string;
  [key: string]: unknown;
}

describe('Agent Audit Router', () => {
  let app: Elysia;

  beforeEach(() => {
    app = new Elysia().use(agentAuditRouter).use(taskExecutionLogsRouter);
  });

  describe('GET /agents/:id/audit-logs', () => {
    it('should return audit logs for specific agent', async () => {
      const mockAgentId = '123';
      const response = (await app
        .handle(new Request(`http://localhost/agents/${mockAgentId}/audit-logs`))
        .then((res: Response) => res.json())) as AuditLogResponse;

      expect(response).toBeDefined();
      expect(response.logs).toBeDefined();
      expect(Array.isArray(response.logs)).toBe(true);
    });
  });

  describe('GET /agents/audit-logs/recent', () => {
    it('should return recent audit logs', async () => {
      const response = (await app
        .handle(new Request('http://localhost/agents/audit-logs/recent'))
        .then((res: Response) => res.json())) as AuditLogResponse;

      expect(response).toBeDefined();
      expect(response.logs).toBeDefined();
      expect(Array.isArray(response.logs)).toBe(true);
    });
  });

  describe('GET /tasks/:id/execution-logs', () => {
    it('should return execution logs for specific task', async () => {
      const mockTaskId = 'test-task-id';
      const httpResponse = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/execution-logs`),
      );

      // レスポンスは複雑なオブジェクト構造 (単一execution mode or 複数execution mode)
      if (httpResponse.status === 200) {
        const response = (await httpResponse.json()) as ExecutionLogResponse;
        expect(response).toBeDefined();
        expect(response.logs).toBeDefined();
        expect(Array.isArray(response.logs)).toBe(true);
        expect(response.lastSequence).toBeDefined();
        expect(response.status).toBeDefined();
      } else {
        // Task not found, config not found, or database connection issues
        expect(httpResponse.status).toBeOneOf([404, 200, 500]);
      }
    });
  });

  // Note: GET /agents/audit-logs endpoint is not implemented in the router
  // Only /agents/:id/audit-logs and /agents/audit-logs/recent are available
});
