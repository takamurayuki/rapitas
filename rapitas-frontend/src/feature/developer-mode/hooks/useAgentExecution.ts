import { useState, useCallback } from "react";
import type { AgentExecution, AgentExecutionStatus, AIAgentConfig } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export type ExecuteTaskOptions = {
  agentConfigId?: number;
  workingDirectory?: string;
  timeout?: number;
  skipApproval?: boolean;
};

export type AgentSessionResponse = {
  id: number;
  status: string;
  output?: string;
  [key: string]: unknown;
};

export type RegisteredAgentType = {
  id: number;
  agentType: string;
  name: string;
  isActive: boolean;
};

export type UseAgentExecutionReturn = {
  isExecuting: boolean;
  currentExecution: AgentExecution | null;
  error: string | null;
  executeTask: (taskId: number, options?: ExecuteTaskOptions) => Promise<{ sessionId: number } | { approvalRequestId: number }>;
  stopExecution: (sessionId: number) => Promise<void>;
  getSession: (sessionId: number) => Promise<AgentSessionResponse>;
  getAgents: () => Promise<AIAgentConfig[]>;
  getAgentTypes: () => Promise<{ registered: RegisteredAgentType[]; available: string[] }>;
};

export function useAgentExecution(): UseAgentExecutionReturn {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<AgentExecution | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeTask = useCallback(
    async (taskId: number, options: ExecuteTaskOptions = {}) => {
      setIsExecuting(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Execution failed");
        }

        if (data.requiresApproval) {
          return { approvalRequestId: data.approvalRequestId };
        }

        return { sessionId: data.sessionId };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        throw err;
      } finally {
        setIsExecuting(false);
      }
    },
    []
  );

  const stopExecution = useCallback(async (sessionId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/sessions/${sessionId}/stop`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to stop execution");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    }
  }, []);

  const getSession = useCallback(async (sessionId: number) => {
    const res = await fetch(`${API_BASE_URL}/agents/sessions/${sessionId}`);
    if (!res.ok) {
      throw new Error("Failed to fetch session");
    }
    return res.json();
  }, []);

  const getAgents = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/agents`);
    if (!res.ok) {
      throw new Error("Failed to fetch agents");
    }
    return res.json();
  }, []);

  const getAgentTypes = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/agents/types`);
    if (!res.ok) {
      throw new Error("Failed to fetch agent types");
    }
    return res.json();
  }, []);

  return {
    isExecuting,
    currentExecution,
    error,
    executeTask,
    stopExecution,
    getSession,
    getAgents,
    getAgentTypes,
  };
}
