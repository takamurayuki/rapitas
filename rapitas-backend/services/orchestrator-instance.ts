/**
 * Shared orchestrator singleton instance
 * Provides a centralized orchestrator accessible from both routes and services.
 */
import { prisma } from "../config/database";
import { createOrchestrator } from "./agents/agent-orchestrator";
import { realtimeService } from "./realtime-service";

const orchestrator = createOrchestrator(prisma);

// Forward orchestrator events to realtime service
orchestrator.addEventListener((event) => {
  const executionChannel = `execution:${event.executionId}`;
  const sessionChannel = `session:${event.sessionId}`;

  const broadcastToBoth = (
    eventType: string,
    data: Record<string, unknown>,
  ) => {
    realtimeService.broadcast(executionChannel, eventType, data);
    realtimeService.broadcast(sessionChannel, eventType, data);
  };

  switch (event.type) {
    case "execution_started":
      broadcastToBoth("execution_started", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_output": {
      const outputData = event.data as { output: string; isError: boolean };
      realtimeService.broadcast(executionChannel, "execution_output", {
        executionId: event.executionId,
        output: outputData.output,
        isError: outputData.isError,
        timestamp: new Date().toISOString(),
      });
      realtimeService.broadcast(sessionChannel, "execution_output", {
        executionId: event.executionId,
        output: outputData.output,
        isError: outputData.isError,
        timestamp: new Date().toISOString(),
      });
      break;
    }
    case "execution_completed":
      broadcastToBoth("execution_completed", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        result: event.data,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_failed":
      broadcastToBoth("execution_failed", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        error: event.data,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_cancelled":
      broadcastToBoth("execution_cancelled", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        timestamp: event.timestamp.toISOString(),
      });
      break;
  }
});

export { orchestrator };
