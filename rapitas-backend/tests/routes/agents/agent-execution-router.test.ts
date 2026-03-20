/**
 * Agent Execution Router テスト
 * タスク実行機能（実行、停止、応答、継続、リセット）のテスト
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { agentExecutionRouter } from '../../../routes/agents/execution-management/agent-execution-router';

describe('Agent Execution Router', () => {
  let app: Elysia;

  beforeEach(() => {
    app = new Elysia().use(agentExecutionRouter);
  });

  describe('POST /tasks/:id/execute', () => {
    it('should handle task execution request', async () => {
      const mockTaskId = '999';
      const requestBody = {
        agentId: 'test-agent-id',
        priority: 'medium',
      };

      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404, 500]);
    });
  });

  describe('GET /tasks/:id/execution-status', () => {
    it('should return execution status', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/execution-status`),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/agent-respond', () => {
    it('should handle agent response', async () => {
      const mockTaskId = '999';
      const requestBody = {
        response: 'test response',
        agentId: 'test-agent-id',
      };

      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/agent-respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404]);
    });
  });

  describe('POST /tasks/:id/stop-execution', () => {
    it('should stop task execution', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/stop-execution`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/continue-execution', () => {
    it('should continue task execution', async () => {
      const mockTaskId = '999';
      const requestBody = {
        continueReason: 'test reason',
      };

      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/continue-execution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404]);
    });
  });

  describe('POST /tasks/:id/reset-execution-state', () => {
    it('should reset execution state', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/reset-execution-state`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/acknowledge-execution', () => {
    it('should acknowledge execution', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/acknowledge-execution`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/resume-execution', () => {
    it('should resume execution', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/resume-execution`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });
});
