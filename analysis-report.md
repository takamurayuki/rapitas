# Rapitas Codebase Analysis Report

> Generated: 2026-03-04T12:04:47.789Z
> Execution time: 19206ms
> Project root: `C:\Projects\rapitas`

---

## 1. コードメトリクス

### サマリ
| 項目 | 値 |
|------|-----|
| 総ファイル数 | 771 |
| 総コード行数 | 185,094 |
| 総サイズ | 10.6 MB |

### 拡張子別
| 拡張子 | ファイル数 | 行数 | サイズ | 平均行数 |
|--------|-----------|------|--------|----------|
| .ts | 247 | 81,360 | 2.4 MB | 329 |
| .tsx | 169 | 65,442 | 2.4 MB | 387 |
| .md | 179 | 13,691 | 559.1 KB | 76 |
| .yaml | 4 | 13,219 | 437.0 KB | 3305 |
| .json | 10 | 3,258 | 103.3 KB | 326 |
| .js | 95 | 2,745 | 3.7 MB | 29 |
| .css | 8 | 1,769 | 299.2 KB | 221 |
| .yml | 8 | 1,246 | 40.2 KB | 156 |
| .html | 41 | 1,195 | 760.0 KB | 29 |
| .prisma | 1 | 1,011 | 39.7 KB | 1011 |
| .sql | 8 | 154 | 5.3 KB | 19 |
| .toml | 1 | 4 | 131 B | 4 |

### ディレクトリ別
| ディレクトリ | ファイル数 | 行数 | サイズ |
|-------------|-----------|------|--------|
| rapitas-frontend | 257 | 94,166 | 3.2 MB |
| rapitas-backend | 355 | 77,376 | 2.4 MB |
| rapitas-desktop | 141 | 5,134 | 4.7 MB |
| analysis-result.json | 1 | 2,998 | 96.1 KB |
| .github | 9 | 1,441 | 47.4 KB |
| docs | 1 | 839 | 22.9 KB |
| analysis-report.md | 1 | 803 | 45.7 KB |
| pnpm-lock.yaml | 1 | 713 | 22.2 KB |
| project-guide.md | 1 | 684 | 22.5 KB |
| README.md | 1 | 473 | 13.9 KB |
| project-improve.md | 1 | 432 | 13.6 KB |
| package.json | 1 | 30 | 1.3 KB |
| .vscode | 1 | 5 | 127 B |

### 最大ファイル Top20
| # | ファイル | 行数 | サイズ |
|---|---------|------|--------|
| 1 | `rapitas-frontend\pnpm-lock.yaml` | 10,822 | 362.2 KB |
| 2 | `rapitas-backend\services\agents\agent-orchestrator.ts` | 3,936 | 128.4 KB |
| 3 | `analysis-result.json` | 2,998 | 96.1 KB |
| 4 | `rapitas-frontend\src\components\note\NoteEditor.tsx` | 2,998 | 105.2 KB |
| 5 | `rapitas-frontend\src\app\tasks\[id]\TaskDetailClient.tsx` | 2,044 | 84.1 KB |
| 6 | `rapitas-frontend\src\components\category\IconData.ts` | 2,023 | 54.2 KB |
| 7 | `rapitas-frontend\src\feature\developer-mode\components\AIAccordionPanel.tsx` | 1,696 | 70.0 KB |
| 8 | `rapitas-backend\services\agents\claude-code-agent.ts` | 1,582 | 62.8 KB |
| 9 | `rapitas-backend\routes\tasks\tasks.ts` | 1,568 | 52.4 KB |
| 10 | `rapitas-frontend\src\app\HomeClient.tsx` | 1,564 | 66.5 KB |
| 11 | `rapitas-backend\routes\agents\agent-execution-router.ts` | 1,557 | 56.2 KB |
| 12 | `rapitas-frontend\src\feature\developer-mode\components\DeveloperModeConfig.tsx` | 1,556 | 56.8 KB |
| 13 | `rapitas-backend\routes\agents\ai-agent.ts` | 1,528 | 48.5 KB |
| 14 | `rapitas-frontend\src\feature\developer-mode\components\AIAnalysisPanel.tsx` | 1,416 | 60.1 KB |
| 15 | `rapitas-frontend\src\feature\tasks\components\MemoSection.tsx` | 1,405 | 52.4 KB |
| 16 | `rapitas-desktop\scripts\dev.js` | 1,364 | 47.3 KB |
| 17 | `rapitas-frontend\src\components\Header.tsx` | 1,256 | 46.7 KB |
| 18 | `rapitas-backend\services\parallel-execution\sub-agent-controller.ts` | 1,250 | 38.1 KB |
| 19 | `rapitas-frontend\src\app\themes\page.tsx` | 1,190 | 49.6 KB |
| 20 | `rapitas-frontend\src\app\globals.css` | 1,177 | 24.3 KB |

---

## 2. アーキテクチャ

### Backend
- **ルートファイル数**: 58
- **検出エンドポイント数**: 357
- **サービス数**: 56

<details>
<summary>エンドポイント一覧 (357件)</summary>

| メソッド | パス | ファイル |
|----------|------|---------|
| GET | `/agents/:id/audit-logs` | `rapitas-backend\routes\agents\agent-audit-router.ts` |
| GET | `/agents/audit-logs/recent` | `rapitas-backend\routes\agents\agent-audit-router.ts` |
| GET | `/agents/:id/execution-logs` | `rapitas-backend\routes\agents\agent-audit-router.ts` |
| GET | `/agents` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| GET | `/agents/all` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| PUT | `/agents/:id/toggle-active` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| GET | `/agents/default` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| PUT | `/agents/:id/set-default` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| DELETE | `/agents/default` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| GET | `/agents/config-schemas` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| GET | `/agents/config-schema/:agentType` | `rapitas-backend\routes\agents\agent-config-router.ts` |
| GET | `/agent-execution-config/:taskId` | `rapitas-backend\routes\agents\agent-execution-config.ts` |
| PUT | `/agent-execution-config/:taskId` | `rapitas-backend\routes\agents\agent-execution-config.ts` |
| PATCH | `/agent-execution-config/:taskId` | `rapitas-backend\routes\agents\agent-execution-config.ts` |
| DELETE | `/agent-execution-config/:taskId` | `rapitas-backend\routes\agents\agent-execution-config.ts` |
| GET | `/agent-execution-config/defaults/values` | `rapitas-backend\routes\agents\agent-execution-config.ts` |
| POST | `/tasks/:id/execute` | `rapitas-backend\routes\agents\agent-execution-router.ts` |
| GET | `/tasks/:id/execution-status` | `rapitas-backend\routes\agents\agent-execution-router.ts` |
| POST | `/tasks/:id/agent-respond` | `rapitas-backend\routes\agents\agent-execution-router.ts` |
| POST | `/tasks/:id/stop-execution` | `rapitas-backend\routes\agents\agent-execution-router.ts` |
| POST | `/tasks/:id/continue-execution` | `rapitas-backend\routes\agents\agent-execution-router.ts` |
| POST | `/tasks/:id/reset-execution-state` | `rapitas-backend\routes\agents\agent-execution-router.ts` |
| GET | `/agent-metrics/` | `rapitas-backend\routes\agents\agent-metrics.ts` |
| GET | `/agent-metrics/overview` | `rapitas-backend\routes\agents\agent-metrics.ts` |
| GET | `/agent-metrics/trends` | `rapitas-backend\routes\agents\agent-metrics.ts` |
| GET | `/agent-metrics/performance` | `rapitas-backend\routes\agents\agent-metrics.ts` |
| GET | `/agent-metrics/:agentId` | `rapitas-backend\routes\agents\agent-metrics.ts` |
| GET | `/agents/sessions/:id` | `rapitas-backend\routes\agents\agent-session-router.ts` |
| POST | `/agents/sessions/:id/stop` | `rapitas-backend\routes\agents\agent-session-router.ts` |
| GET | `/agents/resumable-executions` | `rapitas-backend\routes\agents\agent-session-router.ts` |
| GET | `/agents/interrupted-executions` | `rapitas-backend\routes\agents\agent-session-router.ts` |
| GET | `/agents/encryption-status` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| GET | `/agents/config-schemas` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| GET | `/agents/diagnose` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| GET | `/agents/system-status` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| GET | `/agents/validate-config` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| GET | `/agents/health` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| POST | `/agents/shutdown` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| POST | `/agents/restart` | `rapitas-backend\routes\agents\agent-system-router.ts` |
| GET | `/agents/versions` | `rapitas-backend\routes\agents\agent-version-management.ts` |
| GET | `/agent-types/:agentType/versions` | `rapitas-backend\routes\agents\agent-version-management.ts` |
| POST | `/agents/:id/update` | `rapitas-backend\routes\agents\agent-version-management.ts` |
| POST | `/agents/:id/install` | `rapitas-backend\routes\agents\agent-version-management.ts` |
| POST | `/agents/:id/uninstall` | `rapitas-backend\routes\agents\agent-version-management.ts` |
| GET | `/agents/:id/version-history` | `rapitas-backend\routes\agents\agent-version-management.ts` |
| POST | `/agents` | `rapitas-backend\routes\agents\ai-agent.ts` |
| PATCH | `/agents/:id` | `rapitas-backend\routes\agents\ai-agent.ts` |
| GET | `/agents/:id` | `rapitas-backend\routes\agents\ai-agent.ts` |
| DELETE | `/agents/:id` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/:id/api-key` | `rapitas-backend\routes\agents\ai-agent.ts` |
| DELETE | `/agents/:id/api-key` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/:id/test` | `rapitas-backend\routes\agents\ai-agent.ts` |
| GET | `/agents/types` | `rapitas-backend\routes\agents\ai-agent.ts` |
| GET | `/agents/models` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/development` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/review` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/validate-config` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/:id/test-connection` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/executions/:id/acknowledge` | `rapitas-backend\routes\agents\ai-agent.ts` |
| POST | `/agents/executions/:id/resume` | `rapitas-backend\routes\agents\ai-agent.ts` |
| GET | `/tasks/executing` | `rapitas-backend\routes\agents\ai-agent.ts` |
| GET | `/approvals/` | `rapitas-backend\routes\agents\approvals.ts` |
| GET | `/approvals/:id` | `rapitas-backend\routes\agents\approvals.ts` |
| POST | `/approvals/:id/approve` | `rapitas-backend\routes\agents\approvals.ts` |
| POST | `/approvals/:id/reject` | `rapitas-backend\routes\agents\approvals.ts` |
| POST | `/approvals/:id/approve-code-review` | `rapitas-backend\routes\agents\approvals.ts` |
| POST | `/approvals/:id/reject-code-review` | `rapitas-backend\routes\agents\approvals.ts` |
| POST | `/approvals/:id/request-changes` | `rapitas-backend\routes\agents\approvals.ts` |
| GET | `/approvals/:id/diff` | `rapitas-backend\routes\agents\approvals.ts` |
| POST | `/approvals/bulk-approve` | `rapitas-backend\routes\agents\approvals.ts` |
| GET | `/cli-tools` | `rapitas-backend\routes\agents\cli-tools-management.ts` |
| GET | `/cli-tools/:toolId` | `rapitas-backend\routes\agents\cli-tools-management.ts` |
| POST | `/cli-tools/:toolId/install` | `rapitas-backend\routes\agents\cli-tools-management.ts` |
| POST | `/cli-tools/:toolId/update` | `rapitas-backend\routes\agents\cli-tools-management.ts` |
| POST | `/cli-tools/:toolId/auth` | `rapitas-backend\routes\agents\cli-tools-management.ts` |
| GET | `/cli-tools/:toolId/install-guide` | `rapitas-backend\routes\agents\cli-tools-management.ts` |
| GET | `/api/execution-logs` | `rapitas-backend\routes\agents\execution-logs.ts` |
| GET | `/api/execution-logs/:executionId` | `rapitas-backend\routes\agents\execution-logs.ts` |
| GET | `/api/execution-logs/:executionId/download` | `rapitas-backend\routes\agents\execution-logs.ts` |
| GET | `/api/execution-logs/:executionId/errors` | `rapitas-backend\routes\agents\execution-logs.ts` |
| GET | `/parallel/tasks/:id/analyze` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| GET | `/parallel/tasks/:id/analyze/stream` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| POST | `/parallel/tasks/:id/execute` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| GET | `/parallel/sessions/:sessionId/status` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| POST | `/parallel/sessions/:sessionId/stop` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| GET | `/parallel/sessions/:sessionId/logs` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| GET | `/parallel/sessions/:sessionId/logs/stream` | `rapitas-backend\routes\agents\parallel-execution.ts` |
| POST | `/ai/chat` | `rapitas-backend\routes\ai\ai-chat.ts` |
| POST | `/ai/chat/stream` | `rapitas-backend\routes\ai\ai-chat.ts` |
| GET | `/ai/providers` | `rapitas-backend\routes\ai\ai-chat.ts` |
| GET | `/tasks/:id/prompts` | `rapitas-backend\routes\ai\prompts.ts` |
| POST | `/tasks/:id/prompts` | `rapitas-backend\routes\ai\prompts.ts` |
| PATCH | `/prompts/:id` | `rapitas-backend\routes\ai\prompts.ts` |
| DELETE | `/prompts/:id` | `rapitas-backend\routes\ai\prompts.ts` |
| POST | `/tasks/:id/prompts/generate-all` | `rapitas-backend\routes\ai\prompts.ts` |
| GET | `/system-prompts` | `rapitas-backend\routes\ai\system-prompts.ts` |
| GET | `/system-prompts/:key` | `rapitas-backend\routes\ai\system-prompts.ts` |
| POST | `/system-prompts` | `rapitas-backend\routes\ai\system-prompts.ts` |
| PATCH | `/system-prompts/:key` | `rapitas-backend\routes\ai\system-prompts.ts` |
| DELETE | `/system-prompts/:key` | `rapitas-backend\routes\ai\system-prompts.ts` |
| POST | `/system-prompts/:key/reset` | `rapitas-backend\routes\ai\system-prompts.ts` |
| POST | `/system-prompts/seed` | `rapitas-backend\routes\ai\system-prompts.ts` |
| GET | `/achievements/` | `rapitas-backend\routes\analytics\achievements.ts` |
| POST | `/achievements/:key/unlock` | `rapitas-backend\routes\analytics\achievements.ts` |
| POST | `/achievements/check` | `rapitas-backend\routes\analytics\achievements.ts` |
| GET | `/reports/weekly` | `rapitas-backend\routes\analytics\reports.ts` |
| GET | `/export/tasks` | `rapitas-backend\routes\analytics\reports.ts` |
| GET | `/statistics/overview` | `rapitas-backend\routes\analytics\statistics.ts` |
| GET | `/statistics/daily-study` | `rapitas-backend\routes\analytics\statistics.ts` |
| GET | `/statistics/subject-breakdown` | `rapitas-backend\routes\analytics\statistics.ts` |
| GET | `/statistics/burndown` | `rapitas-backend\routes\analytics\statistics.ts` |
| GET | `/statistics/burnup` | `rapitas-backend\routes\analytics\statistics.ts` |
| GET | `/exam-goals/` | `rapitas-backend\routes\learning\exam-goals.ts` |
| GET | `/exam-goals/:id` | `rapitas-backend\routes\learning\exam-goals.ts` |
| POST | `/exam-goals/` | `rapitas-backend\routes\learning\exam-goals.ts` |
| PATCH | `/exam-goals/:id` | `rapitas-backend\routes\learning\exam-goals.ts` |
| DELETE | `/exam-goals/:id` | `rapitas-backend\routes\learning\exam-goals.ts` |
| GET | `/flashcard-decks` | `rapitas-backend\routes\learning\flashcards.ts` |
| GET | `/flashcard-decks/:id` | `rapitas-backend\routes\learning\flashcards.ts` |
| POST | `/flashcard-decks` | `rapitas-backend\routes\learning\flashcards.ts` |
| DELETE | `/flashcard-decks/:id` | `rapitas-backend\routes\learning\flashcards.ts` |
| POST | `/flashcard-decks/:deckId/cards` | `rapitas-backend\routes\learning\flashcards.ts` |
| PATCH | `/flashcards/:id` | `rapitas-backend\routes\learning\flashcards.ts` |
| DELETE | `/flashcards/:id` | `rapitas-backend\routes\learning\flashcards.ts` |
| POST | `/flashcards/:id/review` | `rapitas-backend\routes\learning\flashcards.ts` |
| GET | `/flashcards/due` | `rapitas-backend\routes\learning\flashcards.ts` |
| POST | `/flashcard-decks/:deckId/generate` | `rapitas-backend\routes\learning\flashcards.ts` |
| GET | `/learning-goals/` | `rapitas-backend\routes\learning\learning-goals.ts` |
| GET | `/learning-goals/:id` | `rapitas-backend\routes\learning\learning-goals.ts` |
| POST | `/learning-goals/` | `rapitas-backend\routes\learning\learning-goals.ts` |
| PATCH | `/learning-goals/:id` | `rapitas-backend\routes\learning\learning-goals.ts` |
| DELETE | `/learning-goals/:id` | `rapitas-backend\routes\learning\learning-goals.ts` |
| POST | `/learning-goals/:id/generate-plan` | `rapitas-backend\routes\learning\learning-goals.ts` |
| POST | `/learning-goals/:id/apply` | `rapitas-backend\routes\learning\learning-goals.ts` |
| GET | `/tasks/:id/resources` | `rapitas-backend\routes\learning\resources.ts` |
| POST | `/resources` | `rapitas-backend\routes\learning\resources.ts` |
| POST | `/resources/upload` | `rapitas-backend\routes\learning\resources.ts` |
| POST | `/resources/upload-from-path` | `rapitas-backend\routes\learning\resources.ts` |
| GET | `/resources/file/:filename` | `rapitas-backend\routes\learning\resources.ts` |
| GET | `/resources/download/:filename` | `rapitas-backend\routes\learning\resources.ts` |
| DELETE | `/resources/:id` | `rapitas-backend\routes\learning\resources.ts` |
| GET | `/study-streaks/` | `rapitas-backend\routes\learning\study-streaks.ts` |
| GET | `/study-streaks/current` | `rapitas-backend\routes\learning\study-streaks.ts` |
| POST | `/study-streaks/record` | `rapitas-backend\routes\learning\study-streaks.ts` |
| GET | `/habits/` | `rapitas-backend\routes\lifestyle\habits.ts` |
| GET | `/habits/:id` | `rapitas-backend\routes\lifestyle\habits.ts` |
| GET | `/habits/streaks/all` | `rapitas-backend\routes\lifestyle\habits.ts` |
| POST | `/habits/` | `rapitas-backend\routes\lifestyle\habits.ts` |
| PATCH | `/habits/:id` | `rapitas-backend\routes\lifestyle\habits.ts` |
| DELETE | `/habits/:id` | `rapitas-backend\routes\lifestyle\habits.ts` |
| POST | `/habits/:id/log` | `rapitas-backend\routes\lifestyle\habits.ts` |
| GET | `/habits/:id/statistics` | `rapitas-backend\routes\lifestyle\habits.ts` |
| GET | `/paid-leave/balance` | `rapitas-backend\routes\lifestyle\paid-leave.ts` |
| PUT | `/paid-leave/balance` | `rapitas-backend\routes\lifestyle\paid-leave.ts` |
| GET | `/paid-leave/history` | `rapitas-backend\routes\lifestyle\paid-leave.ts` |
| POST | `/categories/seed-defaults` | `rapitas-backend\routes\organization\categories.ts` |
| GET | `/categories/default-category` | `rapitas-backend\routes\organization\categories.ts` |
| GET | `/categories/` | `rapitas-backend\routes\organization\categories.ts` |
| GET | `/categories/:id` | `rapitas-backend\routes\organization\categories.ts` |
| POST | `/categories/` | `rapitas-backend\routes\organization\categories.ts` |
| PATCH | `/categories/:id` | `rapitas-backend\routes\organization\categories.ts` |
| DELETE | `/categories/:id` | `rapitas-backend\routes\organization\categories.ts` |
| PATCH | `/categories/:id/set-default` | `rapitas-backend\routes\organization\categories.ts` |
| PATCH | `/categories/reorder` | `rapitas-backend\routes\organization\categories.ts` |
| GET | `/labels/` | `rapitas-backend\routes\organization\labels.ts` |
| GET | `/labels/:id` | `rapitas-backend\routes\organization\labels.ts` |
| POST | `/labels/` | `rapitas-backend\routes\organization\labels.ts` |
| PATCH | `/labels/:id` | `rapitas-backend\routes\organization\labels.ts` |
| PATCH | `/labels/reorder` | `rapitas-backend\routes\organization\labels.ts` |
| DELETE | `/labels/:id` | `rapitas-backend\routes\organization\labels.ts` |
| PUT | `/labels/tasks/:id/labels` | `rapitas-backend\routes\organization\labels.ts` |
| GET | `/milestones/` | `rapitas-backend\routes\organization\milestones.ts` |
| GET | `/milestones/:id` | `rapitas-backend\routes\organization\milestones.ts` |
| POST | `/milestones/` | `rapitas-backend\routes\organization\milestones.ts` |
| PATCH | `/milestones/:id` | `rapitas-backend\routes\organization\milestones.ts` |
| DELETE | `/milestones/:id` | `rapitas-backend\routes\organization\milestones.ts` |
| GET | `/projects/` | `rapitas-backend\routes\organization\projects.ts` |
| GET | `/projects/:id` | `rapitas-backend\routes\organization\projects.ts` |
| POST | `/projects/` | `rapitas-backend\routes\organization\projects.ts` |
| PATCH | `/projects/:id` | `rapitas-backend\routes\organization\projects.ts` |
| DELETE | `/projects/:id` | `rapitas-backend\routes\organization\projects.ts` |
| GET | `/templates/` | `rapitas-backend\routes\organization\templates.ts` |
| GET | `/templates/categories` | `rapitas-backend\routes\organization\templates.ts` |
| GET | `/templates/:id` | `rapitas-backend\routes\organization\templates.ts` |
| POST | `/templates/` | `rapitas-backend\routes\organization\templates.ts` |
| POST | `/templates/from-task/:taskId` | `rapitas-backend\routes\organization\templates.ts` |
| DELETE | `/templates/:id` | `rapitas-backend\routes\organization\templates.ts` |
| POST | `/templates/:id/apply` | `rapitas-backend\routes\organization\templates.ts` |
| GET | `/themes/` | `rapitas-backend\routes\organization\themes.ts` |
| GET | `/themes/default/get` | `rapitas-backend\routes\organization\themes.ts` |
| GET | `/themes/:id` | `rapitas-backend\routes\organization\themes.ts` |
| POST | `/themes/` | `rapitas-backend\routes\organization\themes.ts` |
| PATCH | `/themes/:id` | `rapitas-backend\routes\organization\themes.ts` |
| DELETE | `/themes/:id` | `rapitas-backend\routes\organization\themes.ts` |
| PATCH | `/themes/reorder` | `rapitas-backend\routes\organization\themes.ts` |
| PATCH | `/themes/:id/set-default` | `rapitas-backend\routes\organization\themes.ts` |
| GET | `/daily-schedule/` | `rapitas-backend\routes\scheduling\daily-schedule.ts` |
| POST | `/daily-schedule/` | `rapitas-backend\routes\scheduling\daily-schedule.ts` |
| PATCH | `/daily-schedule/:id` | `rapitas-backend\routes\scheduling\daily-schedule.ts` |
| DELETE | `/daily-schedule/:id` | `rapitas-backend\routes\scheduling\daily-schedule.ts` |
| PUT | `/daily-schedule/bulk` | `rapitas-backend\routes\scheduling\daily-schedule.ts` |
| GET | `/pomodoro/active` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| POST | `/pomodoro/start` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| POST | `/pomodoro/sessions/:id/pause` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| POST | `/pomodoro/sessions/:id/resume` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| POST | `/pomodoro/sessions/:id/complete` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| POST | `/pomodoro/sessions/:id/cancel` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| GET | `/pomodoro/statistics` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| GET | `/pomodoro/history` | `rapitas-backend\routes\scheduling\pomodoro.ts` |
| GET | `/schedules/` | `rapitas-backend\routes\scheduling\schedules.ts` |
| GET | `/schedules/recurrence-presets` | `rapitas-backend\routes\scheduling\schedules.ts` |
| GET | `/schedules/:id` | `rapitas-backend\routes\scheduling\schedules.ts` |
| POST | `/schedules/` | `rapitas-backend\routes\scheduling\schedules.ts` |
| PATCH | `/schedules/:id` | `rapitas-backend\routes\scheduling\schedules.ts` |
| DELETE | `/schedules/:id` | `rapitas-backend\routes\scheduling\schedules.ts` |
| POST | `/schedules/:id/exception` | `rapitas-backend\routes\scheduling\schedules.ts` |
| POST | `/schedules/:id/stop-recurrence` | `rapitas-backend\routes\scheduling\schedules.ts` |
| GET | `/schedules/reminders/pending` | `rapitas-backend\routes\scheduling\schedules.ts` |
| POST | `/schedules/reminders/:id/sent` | `rapitas-backend\routes\scheduling\schedules.ts` |
| GET | `/tasks/:id/time-entries` | `rapitas-backend\routes\scheduling\time-entries.ts` |
| POST | `/tasks/:id/time-entries` | `rapitas-backend\routes\scheduling\time-entries.ts` |
| GET | `/tasks/:id/comments` | `rapitas-backend\routes\social\comments.ts` |
| POST | `/tasks/:id/comments` | `rapitas-backend\routes\social\comments.ts` |
| PATCH | `/comments/:id` | `rapitas-backend\routes\social\comments.ts` |
| DELETE | `/comments/:id` | `rapitas-backend\routes\social\comments.ts` |
| POST | `/comments/:id/links` | `rapitas-backend\routes\social\comments.ts` |
| GET | `/comments/:id/links` | `rapitas-backend\routes\social\comments.ts` |
| PATCH | `/comment-links/:id` | `rapitas-backend\routes\social\comments.ts` |
| DELETE | `/comment-links/:id` | `rapitas-backend\routes\social\comments.ts` |
| GET | `/comments/search` | `rapitas-backend\routes\social\comments.ts` |
| GET | `/github/status` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/integrations` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/integrations` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/integrations/:id` | `rapitas-backend\routes\social\github.ts` |
| PATCH | `/github/integrations/:id` | `rapitas-backend\routes\social\github.ts` |
| DELETE | `/github/integrations/:id` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/integrations/:id/sync-prs` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/integrations/:id/sync-issues` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/integrations/:id/pull-requests` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/pull-requests/:id` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/pull-requests/:id/diff` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/pull-requests/:id/comments` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/pull-requests/:id/approve` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/pull-requests/:id/request-changes` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/integrations/:id/issues` | `rapitas-backend\routes\social\github.ts` |
| GET | `/github/issues/:id` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/issues/:id/comments` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/issues/:id/create-task` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/webhook` | `rapitas-backend\routes\social\github.ts` |
| GET | `/githubx-github-event` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/tasks/:id/create-github-issue` | `rapitas-backend\routes\social\github.ts` |
| POST | `/github/tasks/:id/link-github-pr/:prId` | `rapitas-backend\routes\social\github.ts` |
| POST | `/auth/register` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/authx-forwarded-for` | `rapitas-backend\routes\system\auth.ts` |
| POST | `/auth/login` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/authx-forwarded-for` | `rapitas-backend\routes\system\auth.ts` |
| POST | `/auth/logout` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/auth/me` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/auth/sessions` | `rapitas-backend\routes\system\auth.ts` |
| DELETE | `/auth/sessions/:sessionId` | `rapitas-backend\routes\system\auth.ts` |
| POST | `/auth/cleanup-sessions` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/auth/google/url` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/auth/google` | `rapitas-backend\routes\system\auth.ts` |
| GET | `/auth/google/callback` | `rapitas-backend\routes\system\auth.ts` |
| POST | `/debug-logs/analyze` | `rapitas-backend\routes\system\debug-logs.ts` |
| POST | `/debug-logs/detect-type` | `rapitas-backend\routes\system\debug-logs.ts` |
| POST | `/debug-logs/analyze-stream` | `rapitas-backend\routes\system\debug-logs.ts` |
| GET | `/debug-logs/supported-types` | `rapitas-backend\routes\system\debug-logs.ts` |
| GET | `/developer-mode/config/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| POST | `/developer-mode/enable/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| DELETE | `/developer-mode/disable/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| PATCH | `/developer-mode/config/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| POST | `/developer-mode/analyze/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| POST | `/developer-mode/optimize-prompt/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| POST | `/developer-mode/format-prompt/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| POST | `/developer-mode/generate-branch-name` | `rapitas-backend\routes\system\developer-mode.ts` |
| GET | `/developer-mode/sessions/:taskId` | `rapitas-backend\routes\system\developer-mode.ts` |
| POST | `/developer-mode/generate-title` | `rapitas-backend\routes\system\developer-mode.ts` |
| GET | `/directories/browse` | `rapitas-backend\routes\system\directories.ts` |
| POST | `/directories/validate` | `rapitas-backend\routes\system\directories.ts` |
| GET | `/directories/favorites` | `rapitas-backend\routes\system\directories.ts` |
| POST | `/directories/favorites` | `rapitas-backend\routes\system\directories.ts` |
| PATCH | `/directories/favorites/:id` | `rapitas-backend\routes\system\directories.ts` |
| POST | `/directories/create` | `rapitas-backend\routes\system\directories.ts` |
| DELETE | `/directories/favorites/:id` | `rapitas-backend\routes\system\directories.ts` |
| GET | `/notifications/stream` | `rapitas-backend\routes\system\notifications.ts` |
| GET | `/notifications/` | `rapitas-backend\routes\system\notifications.ts` |
| GET | `/notifications/unread-count` | `rapitas-backend\routes\system\notifications.ts` |
| PATCH | `/notifications/:id/read` | `rapitas-backend\routes\system\notifications.ts` |
| POST | `/notifications/mark-all-read` | `rapitas-backend\routes\system\notifications.ts` |
| DELETE | `/notifications/:id` | `rapitas-backend\routes\system\notifications.ts` |
| DELETE | `/notifications/` | `rapitas-backend\routes\system\notifications.ts` |
| GET | `/rate-limits/` | `rapitas-backend\routes\system\rate-limits.ts` |
| GET | `/screenshots/:filename` | `rapitas-backend\routes\system\screenshots.ts` |
| POST | `/screenshots/capture` | `rapitas-backend\routes\system\screenshots.ts` |
| POST | `/screenshots/capture-all` | `rapitas-backend\routes\system\screenshots.ts` |
| POST | `/screenshots/detect-pages` | `rapitas-backend\routes\system\screenshots.ts` |
| POST | `/screenshots/detect-project` | `rapitas-backend\routes\system\screenshots.ts` |
| GET | `/search/` | `rapitas-backend\routes\system\search.ts` |
| GET | `/search/suggest` | `rapitas-backend\routes\system\search.ts` |
| GET | `/settings/` | `rapitas-backend\routes\system\settings.ts` |
| PATCH | `/settings/` | `rapitas-backend\routes\system\settings.ts` |
| GET | `/settings/api-status` | `rapitas-backend\routes\system\settings.ts` |
| GET | `/settings/api-key` | `rapitas-backend\routes\system\settings.ts` |
| GET | `/settings/api-keys` | `rapitas-backend\routes\system\settings.ts` |
| POST | `/settings/api-key` | `rapitas-backend\routes\system\settings.ts` |
| POST | `/settings/api-key/validate` | `rapitas-backend\routes\system\settings.ts` |
| DELETE | `/settings/api-key` | `rapitas-backend\routes\system\settings.ts` |
| GET | `/settings/models` | `rapitas-backend\routes\system\settings.ts` |
| GET | `/settings/model` | `rapitas-backend\routes\system\settings.ts` |
| POST | `/settings/model` | `rapitas-backend\routes\system\settings.ts` |
| GET | `/events/stream` | `rapitas-backend\routes\system\sse.ts` |
| GET | `/events/subscribe/:channel` | `rapitas-backend\routes\system\sse.ts` |
| GET | `/events/status` | `rapitas-backend\routes\system\sse.ts` |
| POST | `/url-metadata` | `rapitas-backend\routes\system\url-metadata.ts` |
| POST | `/batch/v2/` | `rapitas-backend\routes\tasks\batch-v2.ts` |
| GET | `/batch/v2/stats` | `rapitas-backend\routes\tasks\batch-v2.ts` |
| POST | `/batch/` | `rapitas-backend\routes\tasks\batch.ts` |
| GET | `/batchthemeId` | `rapitas-backend\routes\tasks\batch.ts` |
| GET | `/batchstatus` | `rapitas-backend\routes\tasks\batch.ts` |
| GET | `/batchsince` | `rapitas-backend\routes\tasks\batch.ts` |
| GET | `/tasks/statistics` | `rapitas-backend\routes\tasks\statistics.ts` |
| GET | `/tasks/recent` | `rapitas-backend\routes\tasks\statistics.ts` |
| GET | `/task-analysis-config/:taskId` | `rapitas-backend\routes\tasks\task-analysis-config.ts` |
| PUT | `/task-analysis-config/:taskId` | `rapitas-backend\routes\tasks\task-analysis-config.ts` |
| PATCH | `/task-analysis-config/:taskId` | `rapitas-backend\routes\tasks\task-analysis-config.ts` |
| DELETE | `/task-analysis-config/:taskId` | `rapitas-backend\routes\tasks\task-analysis-config.ts` |
| GET | `/task-analysis-config/defaults/values` | `rapitas-backend\routes\tasks\task-analysis-config.ts` |
| GET | `/tasks/:id/dependency-analysis` | `rapitas-backend\routes\tasks\task-dependency.ts` |
| GET | `/tasks/:id/dependency-analysis/stream` | `rapitas-backend\routes\tasks\task-dependency.ts` |
| GET | `/tasks/search` | `rapitas-backend\routes\tasks\tasks.ts` |
| GET | `/tasks/suggestions` | `rapitas-backend\routes\tasks\tasks.ts` |
| GET | `/tasks/suggestions/ai` | `rapitas-backend\routes\tasks\tasks.ts` |
| GET | `/tasks/suggestions/ai/cache` | `rapitas-backend\routes\tasks\tasks.ts` |
| DELETE | `/tasks/suggestions/ai/cache` | `rapitas-backend\routes\tasks\tasks.ts` |
| GET | `/tasks/` | `rapitas-backend\routes\tasks\tasks.ts` |
| GET | `/tasks/:id` | `rapitas-backend\routes\tasks\tasks.ts` |
| POST | `/tasks/` | `rapitas-backend\routes\tasks\tasks.ts` |
| PATCH | `/tasks/:id` | `rapitas-backend\routes\tasks\tasks.ts` |
| DELETE | `/tasks/:id` | `rapitas-backend\routes\tasks\tasks.ts` |
| POST | `/tasks/:id/cleanup-duplicates` | `rapitas-backend\routes\tasks\tasks.ts` |
| POST | `/tasks/cleanup-all-duplicates` | `rapitas-backend\routes\tasks\tasks.ts` |
| DELETE | `/tasks/:id/subtasks` | `rapitas-backend\routes\tasks\tasks.ts` |
| POST | `/tasks/:id/subtasks/delete-selected` | `rapitas-backend\routes\tasks\tasks.ts` |
| POST | `/tasks/:id/execute` | `rapitas-backend\routes\tasks\tasks.ts` |
| GET | `/workflow-roles` | `rapitas-backend\routes\workflow\workflow-roles.ts` |
| GET | `/workflow-roles/:role` | `rapitas-backend\routes\workflow\workflow-roles.ts` |
| PUT | `/workflow-roles/:role` | `rapitas-backend\routes\workflow\workflow-roles.ts` |
| POST | `/workflow-roles/initialize` | `rapitas-backend\routes\workflow\workflow-roles.ts` |
| GET | `/workflow/tasks/:taskId/files` | `rapitas-backend\routes\workflow\workflow.ts` |
| PUT | `/workflow/tasks/:taskId/files/:fileType` | `rapitas-backend\routes\workflow\workflow.ts` |
| POST | `/workflow/tasks/:taskId/approve-plan` | `rapitas-backend\routes\workflow\workflow.ts` |
| PUT | `/workflow/tasks/:taskId/status` | `rapitas-backend\routes\workflow\workflow.ts` |
| POST | `/workflow/workflow/tasks/:taskId/advance` | `rapitas-backend\routes\workflow\workflow.ts` |
| POST | `/workflow/tasks/:taskId/set-mode` | `rapitas-backend\routes\workflow\workflow.ts` |
| GET | `/workflow/tasks/:taskId/analyze-complexity` | `rapitas-backend\routes\workflow\workflow.ts` |
| GET | `/workflow/modes` | `rapitas-backend\routes\workflow\workflow.ts` |

</details>

<details>
<summary>サービス一覧 (56件)</summary>

- `rapitas-backend\services\achievement-checker.ts`
- `rapitas-backend\services\agent-config-service.ts`
- `rapitas-backend\services\agent-execution-service.ts`
- `rapitas-backend\services\agents\abstraction\abstract-agent.ts`
- `rapitas-backend\services\agents\abstraction\error-handler.ts`
- `rapitas-backend\services\agents\abstraction\event-emitter.ts`
- `rapitas-backend\services\agents\abstraction\execution-manager.ts`
- `rapitas-backend\services\agents\abstraction\index.ts`
- `rapitas-backend\services\agents\abstraction\interfaces.ts`
- `rapitas-backend\services\agents\abstraction\logger.ts`
- `rapitas-backend\services\agents\abstraction\metrics-collector.ts`
- `rapitas-backend\services\agents\abstraction\providers\claude-code-agent-adapter.ts`
- `rapitas-backend\services\agents\abstraction\providers\claude-code-provider.ts`
- `rapitas-backend\services\agents\abstraction\providers\index.ts`
- `rapitas-backend\services\agents\abstraction\registry.ts`
- `rapitas-backend\services\agents\abstraction\types.ts`
- `rapitas-backend\services\agents\agent-factory.ts`
- `rapitas-backend\services\agents\agent-orchestrator.ts`
- `rapitas-backend\services\agents\agent-service.ts`
- `rapitas-backend\services\agents\base-agent.ts`
- `rapitas-backend\services\agents\claude-code-agent.ts`
- `rapitas-backend\services\agents\codex-cli-agent.ts`
- `rapitas-backend\services\agents\execution-file-logger.ts`
- `rapitas-backend\services\agents\gemini-cli-agent.ts`
- `rapitas-backend\services\agents\index.ts`
- `rapitas-backend\services\agents\providers\anthropic-api-provider.ts`
- `rapitas-backend\services\agents\providers\claude-code-provider.ts`
- `rapitas-backend\services\agents\providers\gemini-cli-provider.ts`
- `rapitas-backend\services\agents\providers\gemini-provider.ts`
- `rapitas-backend\services\agents\providers\index.ts`
- `rapitas-backend\services\agents\providers\openai-provider.ts`
- `rapitas-backend\services\agents\question-detection.ts`
- `rapitas-backend\services\agents\unified-interface.ts`
- `rapitas-backend\services\cache-service.ts`
- `rapitas-backend\services\claude-agent.ts`
- `rapitas-backend\services\github-service.ts`
- `rapitas-backend\services\notification-service.ts`
- `rapitas-backend\services\parallel-execution\agent-coordinator.ts`
- `rapitas-backend\services\parallel-execution\dependency-analyzer.ts`
- `rapitas-backend\services\parallel-execution\index.ts`
- `rapitas-backend\services\parallel-execution\log-aggregator.ts`
- `rapitas-backend\services\parallel-execution\parallel-executor.ts`
- `rapitas-backend\services\parallel-execution\parallel-scheduler.ts`
- `rapitas-backend\services\parallel-execution\sub-agent-controller.ts`
- `rapitas-backend\services\parallel-execution\types.ts`
- `rapitas-backend\services\pomodoro-service.ts`
- `rapitas-backend\services\realtime-service.ts`
- `rapitas-backend\services\recurrence-service.ts`
- `rapitas-backend\services\screenshot-service.ts`
- `rapitas-backend\services\sse-utils.ts`
- `rapitas-backend\services\websocket-service.ts`
- `rapitas-backend\services\workflow\complexity-analyzer.ts`
- `rapitas-backend\services\workflow\index.ts`
- `rapitas-backend\services\workflow\workflow-orchestrator.ts`
- `rapitas-backend\src\services\behaviorScheduler.ts`
- `rapitas-backend\src\services\userBehaviorService.ts`

</details>

### Prisma モデル
- **モデル数**: 55
- **総リレーション数**: 40

<details>
<summary>モデル一覧</summary>

| モデル名 | フィールド数 | リレーション数 |
|----------|------------|---------------|
| Category | 11 | 0 |
| Theme | 20 | 1 |
| Project | 9 | 0 |
| Milestone | 9 | 1 |
| Task | 51 | 4 |
| TimeEntry | 10 | 1 |
| PomodoroSession | 14 | 1 |
| Comment | 11 | 1 |
| CommentLink | 7 | 0 |
| ActivityLog | 8 | 1 |
| UserBehavior | 10 | 2 |
| TaskPattern | 17 | 1 |
| UserBehaviorSummary | 14 | 1 |
| Label | 9 | 0 |
| TaskLabel | 6 | 2 |
| ExamGoal | 12 | 0 |
| StudyStreak | 6 | 0 |
| LearningGoal | 14 | 0 |
| Achievement | 11 | 0 |
| UserAchievement | 4 | 1 |
| Habit | 11 | 0 |
| HabitLog | 7 | 1 |
| DailyScheduleBlock | 11 | 0 |
| Resource | 13 | 1 |
| FlashcardDeck | 8 | 0 |
| Flashcard | 11 | 1 |
| TaskTemplate | 11 | 1 |
| DeveloperModeConfig | 14 | 1 |
| AgentSession | 16 | 1 |
| AgentAction | 12 | 1 |
| ApprovalRequest | 17 | 1 |
| Notification | 9 | 0 |
| UserSettings | 22 | 0 |
| AIAgentConfig | 13 | 0 |
| AgentExecution | 21 | 2 |
| AgentExecutionLog | 8 | 1 |
| GitHubIntegration | 14 | 0 |
| GitHubPullRequest | 17 | 1 |
| GitHubPRReview | 9 | 1 |
| GitHubPRComment | 11 | 1 |
| GitHubIssue | 14 | 1 |
| GitCommit | 10 | 1 |
| FavoriteDirectory | 6 | 0 |
| TaskPrompt | 11 | 1 |
| TaskAnalysisConfig | 22 | 2 |
| AgentExecutionConfig | 28 | 2 |
| SystemPrompt | 10 | 0 |
| ScheduleEvent | 19 | 0 |
| PaidLeaveBalance | 10 | 0 |
| TaskSuggestionCache | 15 | 0 |
| AgentConfigAuditLog | 9 | 0 |
| User | 18 | 0 |
| UserSession | 12 | 1 |
| WorkflowRoleConfig | 8 | 1 |
| WorkflowModeConfig | 5 | 0 |

</details>

### Frontend
- **コンポーネント (カテゴリ別)**:
  - **shared-components**: 66ファイル
  - **pages**: 52ファイル
  - **tasks**: 32ファイル
  - **developer-mode**: 16ファイル
  - **calendar**: 2ファイル
  - **other**: 1ファイル
- **カスタムフック数**: 33
- **ストア数**: 8
- **ページルート数**: 40

<details>
<summary>ページルート一覧</summary>

- `/achievements`
- `/agents/metrics`
- `/agents`
- `/agents/versions`
- `/agents/[id]/settings`
- `/approvals`
- `/approvals/[id]`
- `/auth/login`
- `/auth/register`
- `/calendar`
- `/categories`
- `/claude-md-generator`
- `/dashboard`
- `/demo/today-progress`
- `/exam-goals`
- `/flashcards`
- `/focus`
- `/github/issues`
- `/github`
- `/github/pull-requests`
- `/github/pull-requests/[id]`
- `/habits/daily-schedule`
- `/habits`
- `/kanban`
- `/labels`
- `/learning-goals`
- `/`
- `/reports`
- `/settings/cli-tools`
- `/settings/developer-mode/error-demo`
- `/settings/developer-mode`
- `/settings/general`
- `/settings`
- `/settings/shortcuts`
- `/system-prompts`
- `/task-detail`
- `/tasks/detail`
- `/tasks/new`
- `/tasks/[id]`
- `/themes`

</details>

---

## 3. 品質指標

| 指標 | 値 |
|------|-----|
| テストファイル数 | 16 |
| ソースファイル数 | 400 |
| テスト比率 | 0.04 (4.0%) |
| `any`型使用数 | 19 |
| TODO コメント | 76 |
| FIXME コメント | 1 |
| HACK コメント | 1 |
| console.log 使用数 | 119 |
| try/catch ブロック数 | 839 |

---

## 4. AI/エージェントシステム

| 項目 | 値 |
|------|-----|
| AIプロバイダー | Anthropic (Claude), OpenAI, Google (Gemini) |
| エージェントタイプ | manual, code_review, analysis, execution, implementation, codex, openai, gemini, custom |
| エージェントルート数 | 18 |
| エージェントサービス数 | 35 |

<details>
<summary>エージェント関連ファイル</summary>

**ルート:**
- `rapitas-backend\routes\agents\agent-audit-router.ts`
- `rapitas-backend\routes\agents\agent-config-router.ts`
- `rapitas-backend\routes\agents\agent-execution-config.ts`
- `rapitas-backend\routes\agents\agent-execution-router.ts`
- `rapitas-backend\routes\agents\agent-metrics.ts`
- `rapitas-backend\routes\agents\agent-session-router.ts`
- `rapitas-backend\routes\agents\agent-system-router.ts`
- `rapitas-backend\routes\agents\agent-version-management.ts`
- `rapitas-backend\routes\agents\ai-agent.ts`
- `rapitas-backend\routes\agents\approvals.ts`
- `rapitas-backend\routes\agents\cli-tools-management.ts`
- `rapitas-backend\routes\agents\execution-logs.ts`
- `rapitas-backend\routes\agents\parallel-execution.ts`
- `rapitas-backend\tests\agent-audit-router.test.ts`
- `rapitas-backend\tests\agent-config-router.test.ts`
- `rapitas-backend\tests\agent-execution-router.test.ts`
- `rapitas-backend\tests\agent-session-router.test.ts`
- `rapitas-backend\tests\agent-system-router.test.ts`

**サービス:**
- `rapitas-backend\services\agent-config-service.ts`
- `rapitas-backend\services\agent-execution-service.ts`
- `rapitas-backend\services\agents\abstraction\abstract-agent.ts`
- `rapitas-backend\services\agents\abstraction\error-handler.ts`
- `rapitas-backend\services\agents\abstraction\event-emitter.ts`
- `rapitas-backend\services\agents\abstraction\execution-manager.ts`
- `rapitas-backend\services\agents\abstraction\index.ts`
- `rapitas-backend\services\agents\abstraction\interfaces.ts`
- `rapitas-backend\services\agents\abstraction\logger.ts`
- `rapitas-backend\services\agents\abstraction\metrics-collector.ts`
- `rapitas-backend\services\agents\abstraction\providers\claude-code-agent-adapter.ts`
- `rapitas-backend\services\agents\abstraction\providers\claude-code-provider.ts`
- `rapitas-backend\services\agents\abstraction\providers\index.ts`
- `rapitas-backend\services\agents\abstraction\registry.ts`
- `rapitas-backend\services\agents\abstraction\types.ts`
- `rapitas-backend\services\agents\agent-factory.ts`
- `rapitas-backend\services\agents\agent-orchestrator.ts`
- `rapitas-backend\services\agents\agent-service.ts`
- `rapitas-backend\services\agents\base-agent.ts`
- `rapitas-backend\services\agents\claude-code-agent.ts`
- `rapitas-backend\services\agents\codex-cli-agent.ts`
- `rapitas-backend\services\agents\execution-file-logger.ts`
- `rapitas-backend\services\agents\gemini-cli-agent.ts`
- `rapitas-backend\services\agents\index.ts`
- `rapitas-backend\services\agents\providers\anthropic-api-provider.ts`
- `rapitas-backend\services\agents\providers\claude-code-provider.ts`
- `rapitas-backend\services\agents\providers\gemini-cli-provider.ts`
- `rapitas-backend\services\agents\providers\gemini-provider.ts`
- `rapitas-backend\services\agents\providers\index.ts`
- `rapitas-backend\services\agents\providers\openai-provider.ts`
- `rapitas-backend\services\agents\question-detection.ts`
- `rapitas-backend\services\agents\unified-interface.ts`
- `rapitas-backend\services\claude-agent.ts`
- `rapitas-backend\services\parallel-execution\agent-coordinator.ts`
- `rapitas-backend\services\parallel-execution\sub-agent-controller.ts`

</details>

---

## 5. 依存関係

| パッケージ | 本番 | 開発 | 合計 |
|-----------|------|------|------|
| Backend | 18 | 6 | 24 |
| Frontend | 28 | 16 | 44 |
| **合計** | **46** | **22** | **68** |

---

## 6. 機能網羅性

| エリア | ルート | サービス | コンポーネント | フック | モデル | テスト | スコア |
|--------|--------|----------|--------------|--------|--------|--------|--------|
| タスク管理 | 6 | 0 | 44 | 7 | 7 | 0 | **75/100** |
| ポモドーロ/時間管理 | 2 | 1 | 6 | 0 | 1 | 0 | **85/100** |
| AIエージェント | 14 | 35 | 8 | 1 | 7 | 7 | **100/100** |
| ワークフロー | 2 | 3 | 7 | 3 | 2 | 0 | **95/100** |
| GitHub連携 | 1 | 1 | 7 | 1 | 5 | 0 | **95/100** |
| 認証 | 2 | 0 | 4 | 0 | 3 | 1 | **70/100** |
| 通知 | 1 | 1 | 1 | 1 | 1 | 0 | **95/100** |
| 検索 | 1 | 0 | 0 | 2 | 0 | 0 | **35/100** |
| カレンダー/スケジュール | 2 | 2 | 5 | 1 | 2 | 0 | **95/100** |
| 学習/習慣 | 6 | 0 | 8 | 0 | 7 | 0 | **65/100** |
| 分析/レポート | 4 | 1 | 4 | 0 | 2 | 0 | **85/100** |

**平均機能カバレッジスコア: 81/100**

---

## 7. 総合評価

### スコア
| 指標 | スコア |
|------|--------|
| 品質スコア | **55/100** |
| 機能カバレッジスコア | **81/100** |

### 強み
- 豊富なAPIエンドポイント（357件）
- 充実したデータモデル（55モデル）
- 多彩なフロントエンドページ（40ルート）
- 再利用可能なカスタムフック（33個）
- 高カバレッジ機能エリア: タスク管理, ポモドーロ/時間管理, AIエージェント, ワークフロー, GitHub連携, 通知, カレンダー/スケジュール, 分析/レポート

### 弱み
- テストカバレッジが低い（テスト比率: 0.04）
- console.logが多い（119箇所）
- 未解決のTODOが多い（76件）
- 低カバレッジ機能エリア: 検索

### 改善提案
- テストの拡充（特にバックエンドのユニットテスト）
- console.logをロガーライブラリに置き換え
- 機能拡充の優先エリア: 検索

---

## 8. AI評価用プロンプト

以下のプロンプトと共に `analysis-result.json` をAIに投入することで、詳細な評価を得られます。

```
以下はRapitasプロジェクトのコードベース自動分析結果です。
このデータを基に、以下の観点で評価・提案を行ってください：

1. アーキテクチャの成熟度（1-10）と根拠
2. コード品質の評価（1-10）と具体的な改善箇所
3. 機能完成度の評価（1-10）と不足している機能
4. 技術的負債の特定と優先順位付き解消計画
5. スケーラビリティの評価と改善提案
6. セキュリティリスクの特定
7. 次の開発スプリントで取り組むべきTop5タスク

[analysis-result.json の内容をここに貼り付け]
```
