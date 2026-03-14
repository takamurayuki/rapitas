# Question Continuation Execution and Timeout Feature Specification

## Overview

Defines specifications for duplicate execution prevention and timeout auto-continuation functionality in AI agent execution question features.

## Problem Background

### Issues That Were Occurring

1. **Multiple Question Execution**
   - DB status is updated multiple times during question detection
   - Timeout handlers and user responses compete causing duplicate execution

2. **Exception Errors**
   ```
   error: Execution is not waiting for input: running
   ```
   - Status has already been changed to `running` when calling `executeContinuation`

## Solution

### 1. Continuation Execution Lock Mechanism

Introduces lock mechanism to prevent duplicate execution for the same `executionId`.

#### Type Definition

```typescript
type ContinuationLockInfo = {
  executionId: number;
  lockedAt: Date;
  source: "user_response" | "auto_timeout";
};
```

#### Methods

```typescript
// Lock acquisition (returns true on success)
tryAcquireContinuationLock(executionId: number, source: string): boolean

// Lock release
releaseContinuationLock(executionId: number): void

// Check lock status
hasContinuationLock(executionId: number): boolean
```

### 2. Timeout Auto-continuation Feature

When there is no response from the user, the AI agent automatically continues with its own judgment after the default time elapses.

#### Default Settings

```typescript
const DEFAULT_QUESTION_TIMEOUT_SECONDS = 300;  // 5 minutes
const MIN_QUESTION_TIMEOUT_SECONDS = 30;       // 30 seconds
const MAX_QUESTION_TIMEOUT_SECONDS = 1800;     // 30 minutes
```

#### Timeout Processing Flow

```
Question detection
    ↓
Start timeout timer
    ↓
─────────────────────────────
↓                           ↓
User response received      Timeout triggered
    ↓                       ↓
Cancel timer               Try lock acquisition
    ↓                       ↓
Try lock acquisition      Success → Continue with default response
    ↓                       ↓
Success → Continue execution   Fail → Skip processing
Fail → Return error
```

### 3. Default Response Generation

Generates default responses based on question type during timeout:

| Question Type | Default Response |
|--------------|------------------|
| With choices | Select first choice |
| confirmation | "Yes" |
| selection | "1" |
| clarification | "Please continue with default settings" |
| Yes/No type | "y" |

## API Changes

### executeContinuation (for external API)

```typescript
async executeContinuation(
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult>
```

- Attempts lock acquisition
- Returns `{ success: false, errorMessage: "This execution is already being processed" }` if already locked
- Also returns error if status is `running`

### executeContinuationWithLock (for already acquired lock)

```typescript
async executeContinuationWithLock(
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult>
```

- Used when lock has already been acquired in API route
- Skips lock acquisition and executes internal processing directly

## Frontend Notifications

### Timeout Start Event

```typescript
{
  type: "execution_output",
  data: {
    questionTimeoutStarted: true,
    questionTimeoutSeconds: number,
    questionTimeoutDeadline: string (ISO 8601)
  }
}
```

### Timeout Trigger Event

```typescript
{
  type: "execution_output",
  data: {
    questionTimeoutTriggered: true,
    autoResponse: string,
    message: "Automatically continuing due to timeout"
  }
}
```

## State Transition Diagram

```
                     ┌─────────────────────────────────────────┐
                     │                                         │
                     ▼                                         │
idle → running → waiting_for_input ─┬─→ running → completed   │
   │                  │             │      │                   │
   │                  │             │      └── failed         │
   │                  │             │                          │
   │                  │             └─→ (Timeout)              │
   │                  │                    ↓                   │
   │                  │                 running → ...          │
   │                  │                                        │
   └── failed        └── (Lock conflict)                       │
                            ↓                                  │
                         Skip ─────────────────────────────────┘
```

## Error Handling

### 1. Lock Acquisition Failure

```typescript
// Processing in API route
if (!orchestrator.tryAcquireContinuationLock(executionId, "user_response")) {
  return {
    error: "This execution is already being processed",
    currentStatus: "processing",
  };
}
```

### 2. Lock Release on Exception

```typescript
try {
  // Processing
} catch (error) {
  // Error handling
} finally {
  this.releaseContinuationLock(executionId);
}
```

### 3. Status Restoration

Restore status to `waiting_for_input` on processing failure:

```typescript
await prisma.agentExecution.update({
  where: { id: executionId },
  data: { status: "waiting_for_input" },
}).catch(() => {});
```

## Testing

### Unit Tests

`tests/continuation-lock.test.ts`:
- Lock acquisition/release tests
- Conflict scenario tests
- Timeout processing tests
- Error handling tests

### Integration Tests

- Verify timeout cancellation after user response
- Verify auto-continuation after timeout
- Verify consecutive processing of multiple questions

## Configuration

### Environment Variables (future expansion)

```env
# Default seconds for question timeout
QUESTION_TIMEOUT_SECONDS=300
```

## Version

- Specification version: 1.0.0
- Created: 2025-02-04
- Target files:
  - `rapitas-backend/services/agents/agent-orchestrator.ts`
  - `rapitas-backend/services/agents/question-detection.ts`
  - `rapitas-backend/routes/ai-agent.ts`
  - `rapitas-backend/tests/continuation-lock.test.ts`
