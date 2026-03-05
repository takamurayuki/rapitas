# Rapitas Codebase Analysis Report (v2.0.0)

> Generated: 2026-03-05T01:29:51.646Z
> Execution time: 1335ms
> Project root: `C:\Projects\rapitas`

---

## Summary Dashboard

| Metric | Score |
|--------|-------|
| Overall Score | **67/100** |
| Quality Score | 58/100 |
| Feature Coverage | 53/100 |
| Architecture Score | 71/100 |
| Security Score | 91/100 |

---

## 1. Code Metrics

### Summary
| Item | Value |
|------|-------|
| Total files | 871 |
| Total lines | 194,409 |
| Total size | 10.9 MB |
| Avg file lines | 313 |
| Median file lines | 212 |
| Files > 500 lines | 93 |
| Files > 1000 lines | 23 |

### By Extension
| Extension | Files | Lines | Size | Avg Lines |
|-----------|-------|-------|------|-----------|
| .ts | 316 | 88,082 | 2.6 MB | 279 |
| .tsx | 175 | 63,894 | 2.3 MB | 365 |
| .md | 204 | 15,123 | 609.4 KB | 74 |
| .yaml | 4 | 13,219 | 437.0 KB | 3305 |
| .json | 10 | 5,967 | 223.4 KB | 597 |
| .js | 95 | 2,745 | 3.7 MB | 29 |
| .css | 8 | 1,769 | 299.2 KB | 221 |
| .yml | 8 | 1,246 | 40.2 KB | 156 |
| .html | 41 | 1,195 | 760.0 KB | 29 |
| .prisma | 1 | 1,011 | 39.7 KB | 1011 |
| .sql | 8 | 154 | 5.3 KB | 19 |
| .toml | 1 | 4 | 131 B | 4 |

### By Directory
| Directory | Files | Lines | Size |
|-----------|-------|-------|------|
| rapitas-frontend | 276 | 95,317 | 3.2 MB |
| rapitas-backend | 436 | 83,193 | 2.6 MB |
| analysis-result.json | 1 | 5,707 | 216.2 KB |
| rapitas-desktop | 141 | 5,134 | 4.7 MB |
| .github | 9 | 1,441 | 47.4 KB |
| docs | 1 | 839 | 22.9 KB |
| pnpm-lock.yaml | 1 | 713 | 22.2 KB |
| project-guide.md | 1 | 684 | 22.5 KB |
| README.md | 1 | 473 | 13.9 KB |
| analysis-report.md | 1 | 441 | 20.3 KB |
| project-improve.md | 1 | 432 | 13.6 KB |
| package.json | 1 | 30 | 1.3 KB |
| .vscode | 1 | 5 | 127 B |

### Largest Files Top20
| # | File | Lines | Size |
|---|------|-------|------|
| 1 | `rapitas-frontend\pnpm-lock.yaml` | 10,822 | 362.2 KB |
| 2 | `analysis-result.json` | 5,707 | 216.2 KB |
| 3 | `rapitas-frontend\src\components\category\icon-registry.ts` | 1,934 | 53.5 KB |
| 4 | `rapitas-backend\scripts\analyze-codebase.ts` | 1,838 | 70.4 KB |
| 5 | `rapitas-frontend\src\feature\developer-mode\components\AIAccordionPanel.tsx` | 1,699 | 70.1 KB |
| 6 | `rapitas-backend\services\agents\claude-code-agent.ts` | 1,639 | 65.5 KB |
| 7 | `rapitas-backend\routes\agents\agent-execution-router.ts` | 1,583 | 57.4 KB |
| 8 | `rapitas-frontend\src\app\HomeClient.tsx` | 1,566 | 65.0 KB |
| 9 | `rapitas-frontend\src\feature\developer-mode\components\DeveloperModeConfig.tsx` | 1,559 | 56.9 KB |
| 10 | `rapitas-backend\routes\agents\ai-agent.ts` | 1,528 | 48.5 KB |
| 11 | `rapitas-backend\routes\tasks\tasks.ts` | 1,462 | 47.9 KB |
| 12 | `rapitas-frontend\src\app\tasks\[id]\TaskDetailClient.tsx` | 1,426 | 60.0 KB |
| 13 | `rapitas-frontend\src\feature\developer-mode\components\AIAnalysisPanel.tsx` | 1,419 | 60.2 KB |
| 14 | `rapitas-frontend\src\feature\tasks\components\MemoSection.tsx` | 1,408 | 52.5 KB |
| 15 | `rapitas-desktop\scripts\dev.js` | 1,364 | 47.3 KB |
| 16 | `rapitas-frontend\src\components\Header.tsx` | 1,282 | 47.7 KB |
| 17 | `rapitas-backend\services\parallel-execution\sub-agent-controller.ts` | 1,250 | 38.1 KB |
| 18 | `rapitas-frontend\src\app\themes\page.tsx` | 1,193 | 48.6 KB |
| 19 | `rapitas-frontend\src\app\globals.css` | 1,177 | 24.3 KB |
| 20 | `rapitas-desktop\pnpm-lock.yaml` | 1,176 | 36.8 KB |

---

## 2. Complexity Analysis

### God Objects (0 detected)
None detected

### Complexity Warnings (177 total)
| Severity | File | Type | Message |
|----------|------|------|---------|
| [WARN] | `rapitas-frontend\src\components\category\icon-registry.ts` | oversized | Oversized: 1934 lines - consider splitting |
| [WARN] | `rapitas-backend\scripts\analyze-codebase.ts` | oversized | Oversized: 1838 lines - consider splitting |
| [WARN] | `rapitas-backend\scripts\analyze-codebase.ts` | deep_nesting | Max nesting depth: 13 levels |
| [WARN] | `rapitas-frontend\src\feature\developer-mode\components\AIAccordionPanel.tsx` | oversized | Oversized: 1699 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\feature\developer-mode\components\AIAccordionPanel.tsx` | deep_nesting | Max nesting depth: 10 levels |
| [WARN] | `rapitas-backend\services\agents\claude-code-agent.ts` | oversized | Oversized: 1639 lines - consider splitting |
| [WARN] | `rapitas-backend\services\agents\claude-code-agent.ts` | deep_nesting | Max nesting depth: 10 levels |
| [WARN] | `rapitas-backend\routes\agents\agent-execution-router.ts` | oversized | Oversized: 1583 lines - consider splitting |
| [WARN] | `rapitas-backend\routes\agents\agent-execution-router.ts` | deep_nesting | Max nesting depth: 10 levels |
| [WARN] | `rapitas-frontend\src\app\HomeClient.tsx` | oversized | Oversized: 1566 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\app\HomeClient.tsx` | deep_nesting | Max nesting depth: 9 levels |
| [WARN] | `rapitas-frontend\src\app\HomeClient.tsx` | too_many_imports | 31 imports - may indicate low cohesion |
| [WARN] | `rapitas-frontend\src\feature\developer-mode\components\DeveloperModeConfig.tsx` | oversized | Oversized: 1559 lines - consider splitting |
| [WARN] | `rapitas-backend\routes\agents\ai-agent.ts` | oversized | Oversized: 1528 lines - consider splitting |
| [WARN] | `rapitas-backend\routes\agents\ai-agent.ts` | deep_nesting | Max nesting depth: 12 levels |
| [WARN] | `rapitas-backend\routes\tasks\tasks.ts` | oversized | Oversized: 1462 lines - consider splitting |
| [WARN] | `rapitas-backend\routes\tasks\tasks.ts` | deep_nesting | Max nesting depth: 9 levels |
| [WARN] | `rapitas-frontend\src\app\tasks\[id]\TaskDetailClient.tsx` | oversized | Oversized: 1426 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\app\tasks\[id]\TaskDetailClient.tsx` | deep_nesting | Max nesting depth: 12 levels |
| [WARN] | `rapitas-frontend\src\app\tasks\[id]\TaskDetailClient.tsx` | too_many_imports | 35 imports - may indicate low cohesion |
| [WARN] | `rapitas-frontend\src\feature\developer-mode\components\AIAnalysisPanel.tsx` | oversized | Oversized: 1419 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\feature\developer-mode\components\AIAnalysisPanel.tsx` | deep_nesting | Max nesting depth: 10 levels |
| [WARN] | `rapitas-frontend\src\feature\tasks\components\MemoSection.tsx` | oversized | Oversized: 1408 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\feature\tasks\components\MemoSection.tsx` | deep_nesting | Max nesting depth: 9 levels |
| [WARN] | `rapitas-frontend\src\components\Header.tsx` | oversized | Oversized: 1282 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\components\Header.tsx` | deep_nesting | Max nesting depth: 9 levels |
| [WARN] | `rapitas-backend\services\parallel-execution\sub-agent-controller.ts` | oversized | Oversized: 1250 lines - consider splitting |
| [WARN] | `rapitas-backend\services\parallel-execution\sub-agent-controller.ts` | deep_nesting | Max nesting depth: 12 levels |
| [WARN] | `rapitas-frontend\src\app\themes\page.tsx` | oversized | Oversized: 1193 lines - consider splitting |
| [WARN] | `rapitas-frontend\src\app\themes\page.tsx` | deep_nesting | Max nesting depth: 9 levels |

### Long Functions (> 100 lines)
| File | Function | Lines |
|------|----------|-------|
| `rapitas-frontend\src\feature\developer-mode\hooks\useDeveloperMode.ts` | useDeveloperMode | 686 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useExecutionStream.ts` | useExecutionPolling | 589 |
| `rapitas-backend\scripts\analyze-codebase.ts` | generateMarkdownReport | 309 |
| `rapitas-frontend\src\app\api\generate-claude-md\route.ts` | POST | 296 |
| `rapitas-backend\services\agents\orchestrator\task-executor.ts` | executeTask | 252 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useAIAnalysisMode.ts` | useDeveloperMode | 245 |
| `rapitas-frontend\src\components\note\editor\code-block.ts` | createCodeBlockNode | 239 |
| `rapitas-backend\routes\workflow\workflow.ts` | performAutoCommitAndPR | 221 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useApprovals.ts` | useApprovals | 219 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useGitHubIntegration.ts` | useGitHubIntegration | 218 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useExecutionStream.ts` | useExecutionStream | 217 |
| `rapitas-frontend\src\components\note\editor\code-block.ts` | highlightCode | 198 |
| `rapitas-frontend\src\hooks\useDebugLogAnalyzer.ts` | useDebugLogAnalyzer | 186 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useCodeReview.ts` | useCodeReview | 179 |
| `rapitas-backend\scripts\analyze-codebase.ts` | computeScoring | 171 |
| `rapitas-backend\routes\learning\learning-goals.ts` | generateFallbackPlan | 170 |
| `rapitas-frontend\src\components\note\editor\editor-keydown.ts` | handleBackspace | 164 |
| `rapitas-frontend\src\utils\holidays.ts` | getHolidaysForYear | 164 |
| `rapitas-frontend\src\feature\developer-mode\hooks\useNotifications.ts` | useNotifications | 153 |
| `rapitas-backend\services\agents\orchestrator\continuation-executor.ts` | handleQuestionTimeout | 136 |

---

## 3. Security Analysis

### Summary
| Severity | Count |
|----------|-------|
| High/Critical | 0 |
| Medium | 3 |
| Low | 0 |
| **Security Score** | **91/100** |

### Findings
| Severity | File | Line | Type | Message |
|----------|------|------|------|---------|
| [MEDIUM] | `rapitas-frontend\src\app\layout.tsx` | 53 | xss_risk | dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized. |
| [MEDIUM] | `rapitas-frontend\src\components\note\NoteHoverSidebar.tsx` | 241 | xss_risk | dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized. |
| [MEDIUM] | `rapitas-frontend\src\components\note\NoteSidebar.tsx` | 102 | xss_risk | dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized. |

---

## 4. Architecture

### Backend
- **Route files**: 58
- **Endpoints**: 356
- **Services**: 93

### Prisma Models
- **Models**: 55
- **Relations**: 40
- **Oversized models** (> 30 fields): Task(51)

### Frontend
- **shared-components**: 69 files
- **pages**: 54 files
- **tasks**: 32 files
- **developer-mode**: 16 files
- **calendar**: 2 files
- **other**: 1 files
- **search**: 1 files
- **Custom hooks**: 35
- **Stores**: 8
- **Page routes**: 41

### Architecture Health
| Metric | Score |
|--------|-------|
| Coupling Score | 49/100 (lower coupling = better) |
| Cohesion Score | 100/100 |
| Modularity | 58% |
| Layer Violations | 1 |

#### Layer Violations
| File | Issue |
|------|-------|
| `rapitas-backend\services\agent-execution-service.ts` | Service file imports from routes (inverted dependency) |

---

## 5. API Consistency

- **REST Conformance Score**: 94/100
- **Issues**: 20
- **Duplicate endpoints**: 2

### Duplicate Endpoints
| Endpoint | Files |
|----------|-------|
| `GET /agents/config-schemas` | `rapitas-backend\routes\agents\agent-config-router.ts`, `rapitas-backend\routes\agents\agent-system-router.ts` |
| `GET /authx-forwarded-for` | `rapitas-backend\routes\system\auth.ts` |

<details>
<summary>API Issues (20)</summary>

| Endpoint | Type | Message |
|----------|------|---------|
| `PUT /agents/:id/set-default` | verb_in_url | Verb "set" in URL with PUT method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `DELETE /agents/default` | missing_id | DELETE without resource identifier in path |
| `GET /agents/validate-config` | verb_in_url | Verb "validate" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `GET /api/execution-logs/:executionId/download` | verb_in_url | Verb "download" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `GET /parallel/tasks/:id/analyze` | verb_in_url | Verb "analyze" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `GET /parallel/tasks/:id/analyze/stream` | verb_in_url | Verb "analyze" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `GET /resources/download/:filename` | verb_in_url | Verb "download" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `PATCH /categories/:id/set-default` | verb_in_url | Verb "set" in URL with PATCH method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `PATCH /categories/reorder` | missing_id | PATCH without resource identifier in path |
| `PATCH /labels/reorder` | missing_id | PATCH without resource identifier in path |
| `GET /themes/default/get` | verb_in_url | Verb "get" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `PATCH /themes/reorder` | missing_id | PATCH without resource identifier in path |
| `PATCH /themes/:id/set-default` | verb_in_url | Verb "set" in URL with PATCH method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `GET /directories/browse` | verb_in_url | Verb "browse" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |
| `DELETE /notifications/` | missing_id | DELETE without resource identifier in path |
| `PATCH /settings/` | missing_id | PATCH without resource identifier in path |
| `DELETE /settings/api-key` | missing_id | DELETE without resource identifier in path |
| `GET /batchthemeId` | inconsistent_casing | Path segment "batchthemeId" uses non-kebab-case. REST convention prefers kebab-case. |
| `DELETE /tasks/suggestions/ai/cache` | missing_id | DELETE without resource identifier in path |
| `GET /workflow/tasks/:taskId/analyze-complexity` | verb_in_url | Verb "analyze" in URL with GET method. REST prefers nouns in URLs with HTTP verbs indicating the action. |

</details>

---

## 6. Import Graph

- **Circular dependencies**: 0
- **High fan-out files**: 8
- **High fan-in files**: 15

No circular dependencies detected

### High Fan-Out (many imports)
| File | Import Count |
|------|-------------|
| `rapitas-frontend/src/app/tasks/[id]/TaskDetailClient.tsx` | 30 |
| `rapitas-frontend/src/app/HomeClient.tsx` | 26 |
| `rapitas-backend/routes/agents/ai-agent.ts` | 17 |
| `rapitas-frontend/src/app/layout.tsx` | 14 |
| `rapitas-frontend/src/app/tasks/new/NewTaskClient.tsx` | 13 |
| `rapitas-frontend/src/feature/tasks/components/TaskCard.tsx` | 13 |
| `rapitas-frontend/src/components/Header.tsx` | 11 |
| `rapitas-frontend/src/components/note/NoteEditor.tsx` | 11 |

---

## 7. Quality Metrics

| Metric | Value |
|--------|-------|
| Test files | 26 |
| Source files | 465 |
| Test ratio | 6.0% |
| `any` usage | 13 |
| TODO comments | 0 |
| FIXME comments | 0 |
| HACK comments | 0 |
| console.log | 5 |
| try/catch blocks | 821 |
| Empty catch blocks | 49 |
| Test assertions | 961 |
| Assertions/test file | 37.0 |

---

## 8. Test Coverage Details

**Overall test coverage ratio**: 6.0%

### Per-Feature Coverage
| Feature | Source Files | Test Files | Untested | Coverage |
|---------|------------|------------|----------|----------|
| タスク管理 | 68 | 0 | 68 | 0% |
| ポモドーロ/時間管理 | 11 | 1 | 9 | 18% |
| AIエージェント | 104 | 7 | 95 | 9% |
| ワークフロー | 16 | 0 | 16 | 0% |
| GitHub連携 | 11 | 0 | 11 | 0% |
| 認証 | 6 | 1 | 5 | 17% |
| 通知 | 5 | 1 | 3 | 40% |
| 検索 | 7 | 0 | 7 | 0% |
| カレンダー/スケジュール | 10 | 0 | 10 | 0% |
| 学習/習慣 | 14 | 0 | 14 | 0% |
| 分析/レポート | 9 | 1 | 8 | 11% |

### Critical Untested Files (large files without tests)
- `rapitas-backend\scripts\analyze-codebase.ts (1838 lines)`
- `rapitas-frontend\src\feature\developer-mode\components\AIAccordionPanel.tsx (1699 lines)`
- `rapitas-frontend\src\app\HomeClient.tsx (1566 lines)`
- `rapitas-frontend\src\feature\developer-mode\components\DeveloperModeConfig.tsx (1559 lines)`
- `rapitas-backend\routes\agents\ai-agent.ts (1528 lines)`
- `rapitas-backend\routes\tasks\tasks.ts (1462 lines)`
- `rapitas-frontend\src\app\tasks\[id]\TaskDetailClient.tsx (1426 lines)`
- `rapitas-frontend\src\feature\developer-mode\components\AIAnalysisPanel.tsx (1419 lines)`
- `rapitas-frontend\src\feature\tasks\components\MemoSection.tsx (1408 lines)`
- `rapitas-frontend\src\components\Header.tsx (1282 lines)`
- `rapitas-backend\services\parallel-execution\sub-agent-controller.ts (1250 lines)`
- `rapitas-frontend\src\app\themes\page.tsx (1193 lines)`
- `rapitas-backend\services\agents\gemini-cli-agent.ts (1140 lines)`
- `rapitas-frontend\src\feature\developer-mode\components\AgentExecutionPanel.tsx (1139 lines)`
- `rapitas-backend\services\screenshot-service.ts (1131 lines)`
- `rapitas-backend\routes\agents\approvals.ts (1118 lines)`
- `rapitas-frontend\src\app\calendar\page.tsx (1104 lines)`
- `rapitas-frontend\src\app\learning-goals\page.tsx (1101 lines)`
- `rapitas-frontend\src\types\index.ts (1101 lines)`
- `rapitas-backend\services\agents\codex-cli-agent.ts (1089 lines)`

---

## 9. Feature Completeness

| Area | Routes | Services | Components | Hooks | Models | Tests | Untested | Score |
|------|--------|----------|------------|-------|--------|-------|----------|-------|
| タスク管理 | 6 | 3 | 46 | 9 | 7 | 0 | 68 | **80/100** |
| ポモドーロ/時間管理 | 2 | 1 | 7 | 0 | 1 | 1 | 9 | **45/100** |
| AIエージェント | 14 | 72 | 8 | 1 | 7 | 7 | 95 | **95/100** |
| ワークフロー | 2 | 3 | 8 | 3 | 2 | 0 | 16 | **65/100** |
| GitHub連携 | 1 | 1 | 7 | 1 | 5 | 0 | 11 | **50/100** |
| 認証 | 2 | 0 | 4 | 0 | 3 | 1 | 5 | **42/100** |
| 通知 | 1 | 1 | 1 | 1 | 1 | 1 | 3 | **28/100** |
| 検索 | 1 | 0 | 3 | 2 | 0 | 0 | 7 | **24/100** |
| カレンダー/スケジュール | 2 | 2 | 5 | 1 | 2 | 0 | 10 | **50/100** |
| 学習/習慣 | 6 | 0 | 8 | 0 | 7 | 0 | 14 | **55/100** |
| 分析/レポート | 4 | 1 | 4 | 0 | 2 | 1 | 8 | **52/100** |

**Average feature coverage: 53/100**

---

## 10. AI/Agent System

| Item | Value |
|------|-------|
| AI Providers | Anthropic (Claude), OpenAI, Google (Gemini) |
| Agent Types | manual, code_review, analysis, execution, implementation, codex, openai, gemini, custom |
| Agent Routes | 18 |
| Agent Services | 72 |

---

## 11. Dependencies

| Package | Production | Dev | Total |
|---------|-----------|-----|-------|
| Backend | 18 | 6 | 24 |
| Frontend | 28 | 16 | 44 |
| **Total** | **46** | **22** | **68** |

---

## 12. Overall Assessment

### Scores
| Metric | Score |
|--------|-------|
| Overall | **67/100** |
| Quality | 58/100 |
| Feature Coverage | 53/100 |
| Architecture | 71/100 |
| Security | 91/100 |

### Strengths
- 豊富なAPIエンドポイント（356件）
- 充実したデータモデル（55モデル）
- 多彩なフロントエンドページ（41ルート）
- 再利用可能なカスタムフック（35個）
- 型安全性が高い（any使用: 13箇所）
- ログ出力が適切に管理されている
- 重大なセキュリティリスクが検出されていない
- 高カバレッジ機能: タスク管理, AIエージェント

### Weaknesses
- テストカバレッジが低い（テスト比率: 6.0%）
- 空のcatchブロック（49箇所）- エラーが無視されている
- 1000行超のファイルが23個
- レイヤー違反: 1件
- 重複エンドポイント: 2件
- 巨大なPrismaモデル: Task(51フィールド)
- 低カバレッジ機能: ポモドーロ/時間管理, 認証, 通知, 検索

### Improvement Suggestions (Prioritized)
- [P0] テスト拡充 - 246個の未テストソースファイル。特にバックエンドサービスのユニットテストを優先
- [P1] 空のcatchブロックにエラーログまたはリスローを追加
- [P1] レイヤー違反の解消 - 1件の不正なimportを修正
- [P1] 重複エンドポイントの統合
- [P2] 巨大Prismaモデルの正規化（Task: 51フィールド）
- [P2] 機能拡充: ポモドーロ/時間管理, 認証, 通知, 検索

---

## 13. AI Evaluation Prompt

Use the following prompt with `analysis-result.json` for detailed AI evaluation:

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
