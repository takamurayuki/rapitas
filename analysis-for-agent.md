# Codebase Improvement Tasks for AI Agent

> This report is optimized for AI coding agents. Each task includes all necessary context.
> No additional investigation should be required to start working on these items.

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Issues | 51 |
| Critical | 1 |
| High | 14 |
| Medium | 35 |
| Low | 1 |
| Estimated Effort | 129 developer-days |

---

## 🚨 Blockers (Critical Priority)

#### 🔴 [security-sql_injection] Fix sql injection: 2 occurrences

**Priority:** critical | **Effort:** small | **Category:** Security

Potential SQL injection via string interpolation in SQL query

**Files:**
- `rapitas-backend\scripts\migrate-postgres-to-sqlite.ts`

**Acceptance Criteria:**
- [ ] All 2 instances are fixed
- [ ] Input validation is added where necessary
- [ ] Security tests are added to prevent regression

<details>
<summary>Code Context</summary>

```typescript
// rapitas-backend\scripts\migrate-postgres-to-sqlite.ts:136
`INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,

// rapitas-backend\scripts\migrate-postgres-to-sqlite.ts:254
return client.$queryRawUnsafe<AnyRow[]>(`SELECT * FROM "${table}"${orderBy}`);
```
</details>

---

## ⚡ Quick Wins (High Impact, Low Effort)

#### 🔴 [security-sql_injection] Fix sql injection: 2 occurrences

**Priority:** critical | **Effort:** small | **Category:** Security

Potential SQL injection via string interpolation in SQL query

**Files:**
- `rapitas-backend\scripts\migrate-postgres-to-sqlite.ts`

**Acceptance Criteria:**
- [ ] All 2 instances are fixed
- [ ] Input validation is added where necessary
- [ ] Security tests are added to prevent regression

<details>
<summary>Code Context</summary>

```typescript
// rapitas-backend\scripts\migrate-postgres-to-sqlite.ts:136
`INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,

// rapitas-backend\scripts\migrate-postgres-to-sqlite.ts:254
return client.$queryRawUnsafe<AnyRow[]>(`SELECT * FROM "${table}"${orderBy}`);
```
</details>

#### 🟠 [security-xss_risk] Fix xss risk: 2 occurrences

**Priority:** high | **Effort:** small | **Category:** Security

dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized.

**Files:**
- `rapitas-frontend\src\app\layout.tsx`

**Acceptance Criteria:**
- [ ] All 2 instances are fixed
- [ ] Input validation is added where necessary
- [ ] Security tests are added to prevent regression

<details>
<summary>Code Context</summary>

```typescript
// rapitas-frontend\src\app\layout.tsx:68
dangerouslySetInnerHTML={{

// rapitas-frontend\src\app\layout.tsx:87
dangerouslySetInnerHTML={{
```
</details>

#### 🟠 [api-dup-POST--tasks--id-stop-execution] Remove duplicate endpoint: POST /tasks/:id/stop-execution

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\agents\execution\stop-route.test.ts, rapitas-backend\routes\agents\execution\stop-route.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\agents\execution\stop-route.test.ts`
- `rapitas-backend\routes\agents\execution\stop-route.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-POST--execution-fork-fork] Remove duplicate endpoint: POST /execution-fork/fork

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts, rapitas-backend\routes\agents\integrations\execution-fork-routes.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts`
- `rapitas-backend\routes\agents\integrations\execution-fork-routes.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-GET--execution-fork-compare--executionId] Remove duplicate endpoint: GET /execution-fork/compare/:executionId

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts, rapitas-backend\routes\agents\integrations\execution-fork-routes.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts`
- `rapitas-backend\routes\agents\integrations\execution-fork-routes.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-GET--] Remove duplicate endpoint: GET /

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\learning\handlers\learning-goal-crud-handlers.ts, rapitas-backend\routes\system\search\search-route.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\learning\handlers\learning-goal-crud-handlers.ts`
- `rapitas-backend\routes\system\search\search-route.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-GET--tasks-statistics] Remove duplicate endpoint: GET /tasks/statistics

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\tasks\task-statistics.ts, rapitas-backend\routes\tasks\tasks.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\tasks\task-statistics.ts`
- `rapitas-backend\routes\tasks\tasks.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

---

## 📋 All Action Items (Prioritized)

### Security

#### 🔴 [security-sql_injection] Fix sql injection: 2 occurrences

**Priority:** critical | **Effort:** small | **Category:** Security

Potential SQL injection via string interpolation in SQL query

**Files:**
- `rapitas-backend\scripts\migrate-postgres-to-sqlite.ts`

**Acceptance Criteria:**
- [ ] All 2 instances are fixed
- [ ] Input validation is added where necessary
- [ ] Security tests are added to prevent regression

<details>
<summary>Code Context</summary>

```typescript
// rapitas-backend\scripts\migrate-postgres-to-sqlite.ts:136
`INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,

// rapitas-backend\scripts\migrate-postgres-to-sqlite.ts:254
return client.$queryRawUnsafe<AnyRow[]>(`SELECT * FROM "${table}"${orderBy}`);
```
</details>

#### 🟠 [security-command_injection] Fix command injection: 8 occurrences

**Priority:** high | **Effort:** medium | **Category:** Security

Template literal in child process - verify input is not user-controlled

**Files:**
- `rapitas-backend\services\local-llm\model-downloader.ts`
- `rapitas-backend\services\misc\preview-deploy-service.ts`
- `rapitas-backend\services\misc\tech-debt-liquidator.ts`

**Acceptance Criteria:**
- [ ] All 8 instances are fixed
- [ ] Input validation is added where necessary
- [ ] Security tests are added to prevent regression

<details>
<summary>Code Context</summary>

```typescript
// rapitas-backend\services\local-llm\model-downloader.ts:238
execSync(`powershell -Command "Remove-Item -Path '${extractDir}' -Recurse -Force"`, {

// rapitas-backend\services\local-llm\model-downloader.ts:245
execSync(`powershell -Command "Remove-Item -Path '${extractDir}' -Recurse -Force"`, {

// rapitas-backend\services\local-llm\model-downloader.ts:260
execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { timeout: 60000 });
```
</details>

#### 🟠 [security-xss_risk] Fix xss risk: 2 occurrences

**Priority:** high | **Effort:** small | **Category:** Security

dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized.

**Files:**
- `rapitas-frontend\src\app\layout.tsx`

**Acceptance Criteria:**
- [ ] All 2 instances are fixed
- [ ] Input validation is added where necessary
- [ ] Security tests are added to prevent regression

<details>
<summary>Code Context</summary>

```typescript
// rapitas-frontend\src\app\layout.tsx:68
dangerouslySetInnerHTML={{

// rapitas-frontend\src\app\layout.tsx:87
dangerouslySetInnerHTML={{
```
</details>

### Complexity

#### 🟠 [complexity-fn-rapitas-backend-services-agents-orchestrator-task-executor-ts-executeTask] Refactor long function: executeTask in rapitas-backend\services\agents\orchestrator\task-executor.ts

**Priority:** high | **Effort:** medium | **Category:** Complexity

Function "executeTask" has 505 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-backend\services\agents\orchestrator\task-executor.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟠 [complexity-fn-rapitas-backend-services-agents-codex-cli-agent-process-runner-ts-spawnCodexProcess] Refactor long function: spawnCodexProcess in rapitas-backend\services\agents\codex-cli-agent\process-runner.ts

**Priority:** high | **Effort:** medium | **Category:** Complexity

Function "spawnCodexProcess" has 440 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-backend\services\agents\codex-cli-agent\process-runner.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟠 [complexity-fn-rapitas-frontend-src-hooks-common-useSpeechRecognition-ts-useSpeechRecognition] Refactor long function: useSpeechRecognition in rapitas-frontend\src\hooks\common\useSpeechRecognition.ts

**Priority:** high | **Effort:** medium | **Category:** Complexity

Function "useSpeechRecognition" has 416 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\hooks\common\useSpeechRecognition.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟠 [complexity-fn-rapitas-frontend-src-app-settings--hooks-useSettingsData-ts-useSettingsData] Refactor long function: useSettingsData in rapitas-frontend\src\app\settings\_hooks\useSettingsData.ts

**Priority:** high | **Effort:** medium | **Category:** Complexity

Function "useSettingsData" has 385 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\app\settings\_hooks\useSettingsData.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟠 [complexity-fn-rapitas-frontend-src-feature-developer-mode-components-agent-execution-useAgentExecution-ts-useAgentExecution] Refactor long function: useAgentExecution in rapitas-frontend\src\feature\developer-mode\components\agent-execution\useAgentExecution.ts

**Priority:** high | **Effort:** medium | **Category:** Complexity

Function "useAgentExecution" has 336 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\feature\developer-mode\components\agent-execution\useAgentExecution.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟠 [complexity-fn-rapitas-backend-services-ai-natural-language-parser-ts-parseNaturalLanguageTask] Refactor long function: parseNaturalLanguageTask in rapitas-backend\services\ai\natural-language-parser.ts

**Priority:** high | **Effort:** medium | **Category:** Complexity

Function "parseNaturalLanguageTask" has 306 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-backend\services\ai\natural-language-parser.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟡 [complexity-fn-rapitas-frontend-src-components-note-editor-useNoteEditor-ts-useNoteEditor] Refactor long function: useNoteEditor in rapitas-frontend\src\components\note\editor\useNoteEditor.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Function "useNoteEditor" has 300 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\components\note\editor\useNoteEditor.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟡 [complexity-fn-rapitas-frontend-src-app-claude-md-generator--hooks-useWizard-ts-useWizard] Refactor long function: useWizard in rapitas-frontend\src\app\claude-md-generator\_hooks\useWizard.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Function "useWizard" has 284 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\app\claude-md-generator\_hooks\useWizard.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟡 [complexity-fn-rapitas-frontend-src-app-settings-shortcuts-hooks-useShortcutSettings-ts-useShortcutSettings] Refactor long function: useShortcutSettings in rapitas-frontend\src\app\settings\shortcuts\hooks\useShortcutSettings.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Function "useShortcutSettings" has 284 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\app\settings\shortcuts\hooks\useShortcutSettings.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟡 [complexity-fn-rapitas-frontend-src-feature-developer-mode-hooks-useAgentExecutionActions-ts-useAgentExecutionActions] Refactor long function: useAgentExecutionActions in rapitas-frontend\src\feature\developer-mode\hooks\useAgentExecutionActions.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Function "useAgentExecutionActions" has 282 lines. Break it down into smaller, testable functions.

**Files:**
- `rapitas-frontend\src\feature\developer-mode\hooks\useAgentExecutionActions.ts`

**Acceptance Criteria:**
- [ ] Function is split into multiple functions under 50 lines each
- [ ] Each extracted function has a clear, descriptive name
- [ ] Unit tests are added for new functions

#### 🟡 [complexity-nesting-rapitas-backend-utils-database-prisma-optimization-ts] Reduce nesting depth: rapitas-backend\utils\database\prisma-optimization.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Max nesting depth: 9 levels

**Files:**
- `rapitas-backend\utils\database\prisma-optimization.ts`

**Acceptance Criteria:**
- [ ] Maximum nesting depth is reduced to 4 or less
- [ ] Early returns are used where appropriate
- [ ] Complex conditions are extracted to named functions

#### 🟡 [complexity-nesting-rapitas-frontend-src-components-note-editor-editor-keydown-ts] Reduce nesting depth: rapitas-frontend\src\components\note\editor\editor-keydown.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Max nesting depth: 9 levels

**Files:**
- `rapitas-frontend\src\components\note\editor\editor-keydown.ts`

**Acceptance Criteria:**
- [ ] Maximum nesting depth is reduced to 4 or less
- [ ] Early returns are used where appropriate
- [ ] Complex conditions are extracted to named functions

#### 🟡 [complexity-nesting-rapitas-frontend-src-app-calendar--components-CalendarGrid-tsx] Reduce nesting depth: rapitas-frontend\src\app\calendar\_components\CalendarGrid.tsx

**Priority:** medium | **Effort:** small | **Category:** Complexity

Max nesting depth: 9 levels

**Files:**
- `rapitas-frontend\src\app\calendar\_components\CalendarGrid.tsx`

**Acceptance Criteria:**
- [ ] Maximum nesting depth is reduced to 4 or less
- [ ] Early returns are used where appropriate
- [ ] Complex conditions are extracted to named functions

#### 🟡 [complexity-nesting-rapitas-frontend-src-app-tasks--id--components-TaskAISection-tsx] Reduce nesting depth: rapitas-frontend\src\app\tasks\[id]\components\TaskAISection.tsx

**Priority:** medium | **Effort:** small | **Category:** Complexity

Max nesting depth: 9 levels

**Files:**
- `rapitas-frontend\src\app\tasks\[id]\components\TaskAISection.tsx`

**Acceptance Criteria:**
- [ ] Maximum nesting depth is reduced to 4 or less
- [ ] Early returns are used where appropriate
- [ ] Complex conditions are extracted to named functions

#### 🟡 [complexity-nesting-rapitas-backend-services-agents-orchestrator-stale-execution-recovery-ts] Reduce nesting depth: rapitas-backend\services\agents\orchestrator\stale-execution-recovery.ts

**Priority:** medium | **Effort:** small | **Category:** Complexity

Max nesting depth: 9 levels

**Files:**
- `rapitas-backend\services\agents\orchestrator\stale-execution-recovery.ts`

**Acceptance Criteria:**
- [ ] Maximum nesting depth is reduced to 4 or less
- [ ] Early returns are used where appropriate
- [ ] Complex conditions are extracted to named functions

### Test Coverage

#### 🟠 [test-untested-rapitas-backend-src-generated-sqlite-init-sql-ts--1646-lines-] Add tests for: rapitas-backend\src\generated\sqlite-init-sql.ts

**Priority:** high | **Effort:** large | **Category:** Test Coverage

Critical file with 1646 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\src\generated\sqlite-init-sql.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-routes-agents-execution-execute-post-handler-ts--766-lines-] Add tests for: rapitas-backend\routes\agents\execution\execute-post-handler.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 766 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\routes\agents\execution\execute-post-handler.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-scripts-analyze-codebase-agent-report-generator-ts--685-lines-] Add tests for: rapitas-backend\scripts\analyze-codebase\agent-report-generator.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 685 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\scripts\analyze-codebase\agent-report-generator.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-services-workflow-workflow-cli-executor-ts--671-lines-] Add tests for: rapitas-backend\services\workflow\workflow-cli-executor.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 671 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\services\workflow\workflow-cli-executor.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-services-agents-codex-cli-agent-process-runner-ts--590-lines-] Add tests for: rapitas-backend\services\agents\codex-cli-agent\process-runner.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 590 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\services\agents\codex-cli-agent\process-runner.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-routes-agents-execution-execute-route-ts--578-lines-] Add tests for: rapitas-backend\routes\agents\execution\execute-route.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 578 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\routes\agents\execution\execute-route.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-frontend-src-feature-developer-mode-components-ai-accordion-panel-ExecutionBody-tsx--568-lines-] Add tests for: rapitas-frontend\src\feature\developer-mode\components\ai-accordion-panel\ExecutionBody.tsx

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 568 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-frontend\src\feature\developer-mode\components\ai-accordion-panel\ExecutionBody.tsx`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-services-workflow-workflow-orchestrator-ts--561-lines-] Add tests for: rapitas-backend\services\workflow\workflow-orchestrator.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 561 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\services\workflow\workflow-orchestrator.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-frontend-src-feature-developer-mode-hooks-execution-poll-handlers-ts--560-lines-] Add tests for: rapitas-frontend\src\feature\developer-mode\hooks\execution-poll-handlers.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 560 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-frontend\src\feature\developer-mode\hooks\execution-poll-handlers.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-untested-rapitas-backend-services-agents-orchestrator-task-executor-ts--540-lines-] Add tests for: rapitas-backend\services\agents\orchestrator\task-executor.ts

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Critical file with 540 lines has no test coverage. Add unit tests to ensure reliability.

**Files:**
- `rapitas-backend\services\agents\orchestrator\task-executor.ts`

**Acceptance Criteria:**
- [ ] Unit tests cover main functionality
- [ ] Edge cases are tested
- [ ] Test coverage is at least 80% for this file

#### 🟡 [test-feature-Task-Management] Improve test coverage: Task Management

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 9% coverage. 167 files need tests.

**Files:**
- `rapitas-backend\routes\tasks\batch-v2.ts`
- `rapitas-backend\routes\tasks\recurring-tasks.ts`
- `rapitas-backend\routes\tasks\task-analysis-config.ts`
- `rapitas-backend\routes\tasks\task-auto-generate.ts`
- `rapitas-backend\routes\tasks\task-quick-create.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Pomodoro-Time-Management] Improve test coverage: Pomodoro/Time Management

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 21% coverage. 15 files need tests.

**Files:**
- `rapitas-frontend\src\app\tasks\[id]\components\TaskPomodoroButton.tsx`
- `rapitas-frontend\src\feature\tasks\components\PomodoroTimer.tsx`
- `rapitas-frontend\src\feature\tasks\components\TaskTimerManagement.tsx`
- `rapitas-frontend\src\feature\tasks\pomodoro\GlobalPomodoroModal.tsx`
- `rapitas-frontend\src\feature\tasks\pomodoro\GlobalPomodoroWidget.tsx`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-AI-Agent] Improve test coverage: AI Agent

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 11% coverage. 274 files need tests.

**Files:**
- `rapitas-backend\routes\agents\agent-metrics\performance-query.ts`
- `rapitas-backend\routes\agents\agent-metrics\queries.ts`
- `rapitas-backend\routes\agents\agent-metrics\types.ts`
- `rapitas-backend\routes\agents\agent-version\version-read-routes.ts`
- `rapitas-backend\routes\agents\agent-version\version-registry.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Workflow] Improve test coverage: Workflow

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 8% coverage. 72 files need tests.

**Files:**
- `rapitas-backend\routes\ai\system-prompts\default-prompts-workflow-riv.ts`
- `rapitas-backend\routes\ai\system-prompts\default-prompts-workflow-rp.ts`
- `rapitas-backend\routes\ai\system-prompts\default-prompts-workflow.ts`
- `rapitas-backend\routes\workflow\core\workflow-helpers.ts`
- `rapitas-backend\routes\workflow\handlers\workflow-handlers-files.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-GitHub-Integration] Improve test coverage: GitHub Integration

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 8% coverage. 24 files need tests.

**Files:**
- `rapitas-backend\schemas\github.schema.ts`
- `rapitas-backend\services\github\gh-client.ts`
- `rapitas-backend\services\github\issue-operations.ts`
- `rapitas-backend\services\github\pr-operations.ts`
- `rapitas-backend\services\github\pr-read.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Authentication] Improve test coverage: Authentication

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 25% coverage. 15 files need tests.

**Files:**
- `rapitas-backend\register-routes.ts`
- `rapitas-backend\routes\agents\execution\session-helpers.ts`
- `rapitas-backend\routes\system\auth\google-oauth.ts`
- `rapitas-backend\routes\system\auth\index.ts`
- `rapitas-backend\routes\system\auth\rate-limiter.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Search] Improve test coverage: Search

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 29% coverage. 25 files need tests.

**Files:**
- `rapitas-backend\routes\agents\execution\research-prompt-builder.ts`
- `rapitas-backend\routes\system\search\helpers.ts`
- `rapitas-backend\routes\system\search\index.ts`
- `rapitas-backend\routes\system\search\suggest-route.ts`
- `rapitas-frontend\src\app\agents\metrics\_components\MetricsFilters.tsx`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Calendar-Schedule] Improve test coverage: Calendar/Schedule

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 12% coverage. 29 files need tests.

**Files:**
- `rapitas-backend\services\scheduling\task-calendar-sync.ts`
- `rapitas-backend\services\system\backup-scheduler.ts`
- `rapitas-backend\src\services\behavior-scheduler.ts`
- `rapitas-frontend\src\app\calendar\error.tsx`
- `rapitas-frontend\src\app\calendar\page.tsx`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Learning-Habits] Improve test coverage: Learning/Habits

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 12% coverage. 69 files need tests.

**Files:**
- `rapitas-backend\routes\learning\flashcards\ai-generate-routes.ts`
- `rapitas-backend\routes\learning\flashcards\ai-prompts.ts`
- `rapitas-backend\routes\learning\flashcards\crud-routes.ts`
- `rapitas-backend\routes\learning\flashcards\fsrs-helpers.ts`
- `rapitas-backend\routes\learning\handlers\learning-goal-apply-handler.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

#### 🟡 [test-feature-Analytics-Reports] Improve test coverage: Analytics/Reports

**Priority:** medium | **Effort:** large | **Category:** Test Coverage

Feature has only 13% coverage. 26 files need tests.

**Files:**
- `rapitas-backend\routes\analytics\intelligent-suggestions.ts`
- `rapitas-backend\routes\analytics\weekly-review.ts`
- `rapitas-backend\routes\system\monitoring\progress-summary.ts`
- `rapitas-backend\routes\tasks\task-statistics.ts`
- `rapitas-backend\routes\tasks\temp-statistics.ts`

**Acceptance Criteria:**
- [ ] Coverage increased to at least 50%
- [ ] Critical paths are tested
- [ ] Integration tests added for main workflows

### API Consistency

#### 🟠 [api-dup-POST--tasks--id-stop-execution] Remove duplicate endpoint: POST /tasks/:id/stop-execution

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\agents\execution\stop-route.test.ts, rapitas-backend\routes\agents\execution\stop-route.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\agents\execution\stop-route.test.ts`
- `rapitas-backend\routes\agents\execution\stop-route.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-POST--execution-fork-fork] Remove duplicate endpoint: POST /execution-fork/fork

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts, rapitas-backend\routes\agents\integrations\execution-fork-routes.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts`
- `rapitas-backend\routes\agents\integrations\execution-fork-routes.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-GET--execution-fork-compare--executionId] Remove duplicate endpoint: GET /execution-fork/compare/:executionId

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts, rapitas-backend\routes\agents\integrations\execution-fork-routes.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts`
- `rapitas-backend\routes\agents\integrations\execution-fork-routes.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-GET--] Remove duplicate endpoint: GET /

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\learning\handlers\learning-goal-crud-handlers.ts, rapitas-backend\routes\system\search\search-route.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\learning\handlers\learning-goal-crud-handlers.ts`
- `rapitas-backend\routes\system\search\search-route.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟠 [api-dup-GET--tasks-statistics] Remove duplicate endpoint: GET /tasks/statistics

**Priority:** high | **Effort:** small | **Category:** API Consistency

Endpoint is defined in multiple files: rapitas-backend\routes\tasks\task-statistics.ts, rapitas-backend\routes\tasks\tasks.ts. Consolidate to single location.

**Files:**
- `rapitas-backend\routes\tasks\task-statistics.ts`
- `rapitas-backend\routes\tasks\tasks.ts`

**Acceptance Criteria:**
- [ ] Endpoint exists in only one file
- [ ] All consumers use the canonical endpoint
- [ ] Deprecated endpoint is removed

#### 🟢 [api-verb-in-url] Fix verb-in-URL patterns: 10 endpoints

**Priority:** low | **Effort:** medium | **Category:** API Consistency

REST best practice: use HTTP methods for actions, not URL verbs. E.g., POST /tasks/:id instead of POST /tasks/:id/create

**Files:**
- `rapitas-backend\routes\agents\config\agent-config-router.ts`
- `rapitas-backend\routes\agents\monitoring\execution-logs.ts`
- `rapitas-backend\routes\agents\system\agent-system-router.ts`
- `rapitas-backend\routes\learning\resources.ts`
- `rapitas-backend\routes\organization\categories.ts`
- `rapitas-backend\routes\organization\themes.ts`
- `rapitas-backend\routes\system\directories.ts`
- `rapitas-backend\routes\system\local-llm.ts`
- `rapitas-backend\routes\workflow\core\workflow.ts`

**Acceptance Criteria:**
- [ ] URLs use nouns, not verbs
- [ ] HTTP methods indicate the action
- [ ] API documentation is updated

### Architecture

#### 🟡 [arch-layer-rapitas-backend-register-routes-ts] Fix layer violation: rapitas-backend\register-routes.ts

**Priority:** medium | **Effort:** small | **Category:** Architecture

Route file imports from another route file (should go through services)

**Files:**
- `rapitas-backend\register-routes.ts`

**Acceptance Criteria:**
- [ ] Import follows proper layer boundaries
- [ ] If needed, shared module is created at appropriate layer

#### 🟡 [arch-layer-rapitas-backend-routes-agents-agent-version-version-routes-ts] Fix layer violation: rapitas-backend\routes\agents\agent-version\version-routes.ts

**Priority:** medium | **Effort:** small | **Category:** Architecture

Route file imports from another route file (should go through services)

**Files:**
- `rapitas-backend\routes\agents\agent-version\version-routes.ts`

**Acceptance Criteria:**
- [ ] Import follows proper layer boundaries
- [ ] If needed, shared module is created at appropriate layer

#### 🟡 [arch-layer-rapitas-backend-routes-agents-cli-tools-index-ts] Fix layer violation: rapitas-backend\routes\agents\cli-tools\index.ts

**Priority:** medium | **Effort:** small | **Category:** Architecture

Route file imports from another route file (should go through services)

**Files:**
- `rapitas-backend\routes\agents\cli-tools\index.ts`

**Acceptance Criteria:**
- [ ] Import follows proper layer boundaries
- [ ] If needed, shared module is created at appropriate layer

#### 🟡 [arch-layer-rapitas-backend-routes-agents-execution-management-index-ts] Fix layer violation: rapitas-backend\routes\agents\execution-management\index.ts

**Priority:** medium | **Effort:** small | **Category:** Architecture

Route file imports from another route file (should go through services)

**Files:**
- `rapitas-backend\routes\agents\execution-management\index.ts`

**Acceptance Criteria:**
- [ ] Import follows proper layer boundaries
- [ ] If needed, shared module is created at appropriate layer

#### 🟡 [arch-layer-rapitas-backend-routes-agents-system-agent-version-management-ts] Fix layer violation: rapitas-backend\routes\agents\system\agent-version-management.ts

**Priority:** medium | **Effort:** small | **Category:** Architecture

Route file imports from another route file (should go through services)

**Files:**
- `rapitas-backend\routes\agents\system\agent-version-management.ts`

**Acceptance Criteria:**
- [ ] Import follows proper layer boundaries
- [ ] If needed, shared module is created at appropriate layer

### Code Quality

#### 🟡 [quality-any-usage] Reduce `any` type usage: 30 occurrences

**Priority:** medium | **Effort:** medium | **Category:** Code Quality

Replace `any` types with proper TypeScript types for better type safety and IDE support.

**Files:**


**Acceptance Criteria:**
- [ ] any usage reduced by at least 50%
- [ ] Proper types defined for complex objects
- [ ] No new any types introduced

#### 🟡 [quality-empty-catch] Fix empty catch blocks: 7 occurrences

**Priority:** medium | **Effort:** small | **Category:** Code Quality

Empty catch blocks hide errors. Add proper error handling or logging.

**Files:**


**Acceptance Criteria:**
- [ ] All empty catch blocks have proper error handling
- [ ] Errors are logged appropriately
- [ ] User-facing errors have helpful messages

---

## 📁 File Index

Files with multiple issues should be prioritized for refactoring.

| File | Issue Count | Dependencies |
|------|-------------|--------------|
| `rapitas-backend\services\agents\orchestrator\task-executor.ts` | 2 | - |
| `rapitas-backend\services\agents\codex-cli-agent\process-runner.ts` | 2 | - |
| `rapitas-backend\routes\agents\execution-management\execution-fork-routes.ts` | 2 | - |
| `rapitas-backend\routes\agents\integrations\execution-fork-routes.ts` | 2 | - |
| `rapitas-backend\routes\tasks\task-statistics.ts` | 2 | - |
| `rapitas-backend\register-routes.ts` | 2 | - |
| `rapitas-backend\scripts\migrate-postgres-to-sqlite.ts` | 1 | - |
| `rapitas-frontend\src\hooks\common\useSpeechRecognition.ts` | 1 | - |
| `rapitas-frontend\src\app\settings\_hooks\useSettingsData.ts` | 1 | - |
| `rapitas-frontend\src\feature\developer-mode\components\agent-execution\useAgentExecution.ts` | 1 | - |
| `rapitas-backend\services\ai\natural-language-parser.ts` | 1 | - |
| `rapitas-backend\services\local-llm\model-downloader.ts` | 1 | - |
| `rapitas-backend\services\misc\preview-deploy-service.ts` | 1 | - |
| `rapitas-backend\services\misc\tech-debt-liquidator.ts` | 1 | - |
| `rapitas-frontend\src\app\layout.tsx` | 1 | - |
| `rapitas-backend\src\generated\sqlite-init-sql.ts` | 1 | - |
| `rapitas-backend\routes\agents\execution\stop-route.test.ts` | 1 | - |
| `rapitas-backend\routes\agents\execution\stop-route.ts` | 1 | - |
| `rapitas-backend\routes\learning\handlers\learning-goal-crud-handlers.ts` | 1 | - |
| `rapitas-backend\routes\system\search\search-route.ts` | 1 | - |
| `rapitas-backend\routes\tasks\tasks.ts` | 1 | - |
| `rapitas-frontend\src\components\note\editor\useNoteEditor.ts` | 1 | - |
| `rapitas-frontend\src\app\claude-md-generator\_hooks\useWizard.ts` | 1 | - |
| `rapitas-frontend\src\app\settings\shortcuts\hooks\useShortcutSettings.ts` | 1 | - |
| `rapitas-frontend\src\feature\developer-mode\hooks\useAgentExecutionActions.ts` | 1 | - |
| `rapitas-backend\utils\database\prisma-optimization.ts` | 1 | - |
| `rapitas-frontend\src\components\note\editor\editor-keydown.ts` | 1 | - |
| `rapitas-frontend\src\app\calendar\_components\CalendarGrid.tsx` | 1 | - |
| `rapitas-frontend\src\app\tasks\[id]\components\TaskAISection.tsx` | 1 | - |
| `rapitas-backend\services\agents\orchestrator\stale-execution-recovery.ts` | 1 | - |

---

## 🎯 Recommended Execution Order

1. **Start with blockers** - These prevent other improvements
2. **Address quick wins** - Build momentum with easy victories
3. **Tackle high-priority items** - Focus on security and complexity
4. **Improve test coverage** - Ensure stability for future changes
5. **Clean up API consistency** - Better developer experience

---

## 📝 Notes for AI Agent

- Each action item includes specific acceptance criteria
- File paths are relative to project root
- Estimated effort: small (~0.5 day), medium (~2 days), large (~5 days)
- When splitting files, maintain backward compatibility with re-exports
- Run tests after each change to ensure nothing breaks
- Commit changes in logical units matching action items

