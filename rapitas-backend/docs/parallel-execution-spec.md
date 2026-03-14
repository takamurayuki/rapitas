# Parallel Execution System Specification

## Overview

The parallel execution system analyzes dependencies between subtasks and realizes parallel execution by Claude Code sub-agents.

## Architecture

### Component Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    ParallelExecutor                          │
│  (Main orchestrator)                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DependencyAnalyzer │  │ ParallelScheduler │                │
│  │ (Dependency Analysis) │  │ (Scheduling)       │                │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ SubAgentController│  │ AgentCoordinator │                 │
│  │ (Sub-agent)        │  │ (Agent Coordination) │             │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────┐                                        │
│  │  LogAggregator   │                                        │
│  │ (Log Aggregation)│                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

## Dependency Analysis

### Types of Dependencies

| Type | Description | Detection Method |
|------|-------------|------------------|
| `file_sharing` | File sharing dependency | Extract file paths from descriptions/prompts |
| `sequential` | Explicit order dependency | `explicitDependencies` field |
| `data_flow` | Data flow dependency | Future implementation |
| `resource` | Resource conflict | Detected by file locking mechanism |

### Weighting Algorithm

The strength (weight) of dependencies is calculated from the following factors:

1. **Shared file ratio**: Ratio of shared files to related files per task
2. **File type**: Important files (index.ts, schema.prisma, etc.) have higher weights
3. **Priority**: High-priority tasks are executed first in dependencies

```typescript
// Weight calculation formula
weight = (sharedFileRatio * 100) * fileTypeWeight

// File type weights
- index.* : 1.5
- schema.*, config.* : 1.3
- *.ts, *.tsx : 1.2
- *.css, *.scss : 1.1
```

### Determining Parallel Execution Feasibility

Task parallel execution feasibility is determined by:

1. **independenceScore**: Independence score (0-100)
   - 70 or above: Parallel execution possible
   - Below 30: High dependency (warning)

2. **parallelizability**: Parallelizability score (0-100)
   - Calculated from number of dependent/dependee tasks

## Parallel Execution Groups

### Group Structure

```typescript
type ParallelGroup = {
  groupId: number;
  level: number;           // Execution level (starting from 0)
  taskIds: number[];       // Task IDs within group
  canRunParallel: boolean; // Whether parallel execution is possible within group
  estimatedDuration: number;
  internalDependencies: DependencyEdge[];
  dependsOnGroups: number[];
};
```

### Execution Order

1. Execute sequentially starting from level 0 groups
2. Tasks within each group are executed in parallel according to `maxConcurrentAgents`
3. Next level does not start until dependent groups complete

## API Specification

### Endpoints

#### Dependency Analysis

```
GET /parallel/tasks/:id/analyze
```

**Response:**
```json
{
  "success": true,
  "data": {
    "parentTaskId": 1,
    "subtaskCount": 5,
    "nodes": [
      {
        "id": 101,
        "title": "Task 1",
        "priority": "high",
        "depth": 0,
        "independenceScore": 85,
        "parallelizability": 90,
        "dependencies": [],
        "dependents": [102]
      }
    ],
    "edges": [
      {
        "fromTaskId": 101,
        "toTaskId": 102,
        "type": "file_sharing",
        "weight": 45,
        "sharedResources": ["index.ts"]
      }
    ],
    "criticalPath": [101, 102, 105],
    "parallelGroups": [...],
    "plan": {
      "executionOrder": [[101, 103], [102, 104], [105]],
      "estimatedTotalDuration": 4,
      "estimatedSequentialDuration": 9,
      "parallelEfficiency": 55,
      "maxConcurrency": 3
    },
    "recommendations": ["5 tasks can be executed in parallel across 3 groups"],
    "warnings": []
  }
}
```

#### Start Parallel Execution

```
POST /parallel/tasks/:id/execute
```

**Request:**
```json
{
  "config": {
    "maxConcurrentAgents": 3,
    "questionTimeoutSeconds": 300,
    "taskTimeoutSeconds": 900,
    "retryOnFailure": true,
    "logSharing": true,
    "coordinationEnabled": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-1-1234567890",
    "agentSessionId": 1,
    "plan": {
      "groups": 3,
      "maxConcurrency": 3,
      "estimatedTotalDuration": 4,
      "parallelEfficiency": 55
    },
    "status": "running"
  }
}
```

#### Get Session Status

```
GET /parallel/sessions/:sessionId/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "progress": 40,
    "completed": [101, 103],
    "running": [102],
    "pending": [104, 105],
    "failed": [],
    "blocked": []
  }
}
```

#### Get Execution Logs

```
GET /parallel/sessions/:sessionId/logs?taskId=101&level=error&limit=100
```

#### Real-time Log Stream

```
GET /parallel/sessions/:sessionId/logs/stream
```

Delivers logs in real-time using SSE format.

## Inter-agent Coordination

### Resource Locking

Provides resource locking mechanism to prevent file conflicts:

```typescript
// Lock request
const lock = coordinator.requestResourceLock(agentId, taskId, "file.ts");
if (lock.status === "granted") {
  // Safely manipulate file
}

// Release lock
coordinator.releaseResourceLock(agentId, "file.ts");
```

### Data Sharing

Share data between agents:

```typescript
// Share data
coordinator.shareData("api-schema", schema, agentId);

// Get from other agent
const schema = coordinator.getSharedData("api-schema");
```

### Messaging

```typescript
// Broadcast
coordinator.broadcastMessage({
  type: "task_completed",
  fromAgentId: "agent-1",
  toAgentId: "broadcast",
  payload: { taskId: 101 }
});

// Send to specific agent
coordinator.sendMessage("agent-2", "agent-1", "data_share", { key: "value" });
```

## Log Aggregation

### Filtering

```typescript
// By task
aggregator.getLogsByTask(taskId, limit);

// By agent
aggregator.getLogsByAgent(agentId, limit);

// By level
aggregator.getErrorLogs(limit);

// By tag
aggregator.getLogsByTag("git", limit);
```

### Auto-tagging

Automatically extract tags from messages:

- `error`, `warning`: Error and warning messages
- `start`, `complete`: Start and completion messages
- `file`: File operations
- `git`: Git operations
- `test`: Test related
- `build`: Build related

## Configuration Options

```typescript
type ParallelExecutionConfig = {
  maxConcurrentAgents: number;      // Maximum concurrent agent count (default: 3)
  questionTimeoutSeconds: number;   // Question timeout (default: 300)
  taskTimeoutSeconds: number;       // Task timeout (default: 900)
  retryOnFailure: boolean;          // Retry on failure (default: true)
  maxRetries: number;               // Maximum retry count (default: 2)
  logSharing: boolean;              // Log sharing enabled (default: true)
  coordinationEnabled: boolean;     // Agent coordination enabled (default: true)
};
```

## Execution Flow

```
1. Dependency analysis
   ↓
2. Tree map generation
   ↓
3. Parallel group generation
   ↓
4. Execution plan creation
   ↓
5. Session start
   ↓
6. Start level 0 tasks
   ↓
7. Task completion → Dependency resolution → Schedule next task
   ↓
8. All tasks complete → Session end
```

## Troubleshooting

### Circular Dependency Detected

- Warning message will be output
- Review task dependencies

### Task in Blocked State

- Dependent tasks may have failed
- Check failed tasks with `getSessionStatus`

### Low Parallel Efficiency

- Critical path may be long
- Consider task splitting

## Future Expansion Plans

1. **Auto-detection of data flow dependencies**: Automatically detect data dependencies between tasks
2. **Dynamic priority adjustment**: Dynamic priority changes based on execution status
3. **Retry strategies**: Auto-retry functionality for failed tasks
4. **Cost optimization**: Scheduling considering API usage
