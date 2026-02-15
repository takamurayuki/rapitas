# Rapitas Project Guide for AI Agents

> **Purpose**: This document is optimized for AI agents (Claude, GPT-4, GitHub Copilot, etc.) to understand and work effectively with the Rapitas codebase.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture](#3-architecture)
4. [Design Principles](#4-design-principles)
5. [Folder Structure](#5-folder-structure)
6. [Setup Instructions](#6-setup-instructions)
7. [Development Guidelines](#7-development-guidelines)
8. [AI Agent Best Practices](#8-ai-agent-best-practices)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Project Overview

### 1.1 What is Rapitas?

**Rapitas (Rapi+)** is a hierarchical task management system with AI-powered features:

- **Core Purpose**: High-performance task management with AI agent integration for task analysis, subtask generation, and code automation
- **Target Users**: Individual developers, software teams, project managers, and students
- **Key Differentiator**: Built-in Claude Code integration for AI-assisted development workflows

### 1.2 Key Features

| Feature | Description |
|---------|-------------|
| **Task Management** | Hierarchical tasks (parent/child), priorities, labels, time estimates |
| **Kanban Board** | Drag-and-drop status changes |
| **Pomodoro Timer** | Built-in time tracking with cross-window sync |
| **AI Agent Integration** | Task analysis, subtask generation, code execution via Claude Code |
| **GitHub Integration** | Issue/PR sync, automatic linking |
| **Developer Mode** | AI-powered code generation with approval workflows |
| **Desktop App** | Cross-platform via Tauri (Windows, macOS, Linux) |
| **Dual Database** | PostgreSQL (web) / SQLite (desktop) |

### 1.3 Repository Structure

```
rapitas/                    # Monorepo root
├── rapitas-frontend/       # Next.js 16 web application
├── rapitas-backend/        # Bun + Elysia REST API
├── rapitas-desktop/        # Tauri desktop wrapper
├── .claude/                # Claude Code configuration
│   └── CLAUDE.md          # Project rules for Claude
├── PROJECT_DESIGN.md       # Detailed design document (Japanese)
└── project-guide.md        # This file
```

---

## 2. Technology Stack

### 2.1 Frontend Stack

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| Framework | Next.js (App Router) | 16.0.1 | Server/Client components |
| UI Library | React | 19.2.0 | Latest React features |
| Styling | Tailwind CSS | 4.x | New PostCSS plugin architecture |
| State Management | Zustand | 5.0.10 | Lightweight global state |
| Drag & Drop | @hello-pangea/dnd | 18.0.1 | Kanban board |
| Icons | Lucide React | 0.562.0 | Icon library |
| Markdown | react-markdown + remark-gfm | 10.1.0 / 4.0.1 | Task descriptions |
| Code Highlighting | react-syntax-highlighter | 16.1.0 | Code blocks |
| Testing | Storybook | 8.6.14 | Component testing |
| Package Manager | pnpm | - | Fast, disk-efficient |

### 2.2 Backend Stack

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| Runtime | Bun | latest | Fast JavaScript runtime |
| Framework | Elysia | 1.4.15 | Bun-optimized web framework |
| ORM | Prisma | 6.19.0 | Type-safe database access |
| Database (Web) | PostgreSQL | - | Production database |
| Database (Desktop) | SQLite | - | Local embedded database |
| AI SDK | @anthropic-ai/sdk | 0.52.0 | Claude API integration |
| CORS | @elysiajs/cors | 1.4.0 | Cross-origin support |

### 2.3 Desktop Stack

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| Framework | Tauri | 2.x | Rust-based desktop wrapper |
| Language | Rust | 2021 edition | Native performance |
| Plugin | tauri-plugin-shell | 2.x | Process spawning |

### 2.4 Development Tools

| Tool | Purpose |
|------|---------|
| TypeScript 5.x | Type safety across all packages |
| ESLint 9 | Code linting (flat config) |
| Prettier | Code formatting |
| concurrently | Parallel process execution |
| cross-env | Cross-platform environment variables |
| gh CLI | GitHub operations |

---

## 3. Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Rapitas Desktop (Tauri)                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Next.js Frontend (WebView)              │    │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────────────┐    │    │
│  │   │   App   │  │ Feature │  │   Components    │    │    │
│  │   │ Router  │  │ Modules │  │   (UI/Shared)   │    │    │
│  │   └────┬────┘  └────┬────┘  └────────┬────────┘    │    │
│  │        └────────────┼────────────────┘             │    │
│  └─────────────────────┼────────────────────────────────┘    │
│                        │ REST API (localhost:3001)          │
│  ┌─────────────────────┼────────────────────────────────┐    │
│  │              Elysia Backend (Sidecar)                │    │
│  │   ┌─────────┐  ┌────┴────┐  ┌─────────────────┐    │    │
│  │   │   API   │  │ Services│  │   AI Agents     │    │    │
│  │   │ Routes  │  │  Layer  │  │  (Claude Code)  │    │    │
│  │   └────┬────┘  └────┬────┘  └────────┬────────┘    │    │
│  │        └────────────┼────────────────┘             │    │
│  │   ┌─────────────────┴─────────────────────────┐    │    │
│  │   │           Prisma ORM                       │    │    │
│  │   │   ┌──────────┐        ┌──────────┐       │    │    │
│  │   │   │ SQLite   │  or    │PostgreSQL│       │    │    │
│  │   │   │(Desktop) │        │  (Web)   │       │    │    │
│  │   │   └──────────┘        └──────────┘       │    │    │
│  │   └───────────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
[User Action] → [React Component] → fetch() → [Elysia API]
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                              [Prisma ORM]    [Claude AI]    [GitHub API]
                                    │
                                    ▼
                              [Database]
```

### 3.3 API Endpoints (Key)

#### Task Management
- `GET/POST/PATCH/DELETE /tasks` - CRUD operations
- `GET/PATCH /tasks/:id/time-entries` - Time tracking
- `POST /tasks/:id/execute` - **AI agent execution**

#### Developer Mode (AI)
- `POST /developer-mode/analyze/:taskId` - AI task analysis
- `POST /developer-mode/optimize-prompt/:taskId` - Prompt optimization
- `GET /developer-mode/sessions/:taskId` - Session history

#### Approvals
- `GET/POST /approvals` - Approval workflow for AI changes
- `POST /approvals/:id/approve` - Approve AI-generated code

#### GitHub Integration
- `GET/POST /github/integrations` - Manage integrations
- `POST /github/integrations/:id/sync-prs` - Sync pull requests
- `POST /github/integrations/:id/sync-issues` - Sync issues

#### Real-time
- `GET /events/stream` - Server-Sent Events subscription
- `GET /events/subscribe/:channel` - Channel subscription

---

## 4. Design Principles

### 4.1 Frontend Patterns

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Feature-Sliced Design** | `src/feature/` | Domain-based organization |
| **Compound Components** | UI components | Flexible composition |
| **Provider Pattern** | Pomodoro, Toast | Global state injection |
| **Container/Presenter** | `*Client.tsx` + Page | Server/client separation |

### 4.2 Backend Patterns

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Factory Pattern** | `agent-factory.ts` | Agent creation abstraction |
| **Template Method** | `base-agent.ts` | Common/specific logic separation |
| **Singleton** | `AgentFactory`, `RealtimeService` | Instance management |
| **Strategy Pattern** | AI agent implementations | Algorithm switching |

### 4.3 Coding Conventions

#### Naming Rules
| Target | Convention | Example |
|--------|-----------|---------|
| Components | PascalCase | `TaskCard.tsx` |
| Functions | camelCase | `analyzeTask()` |
| Constants | UPPER_SNAKE_CASE | `SYSTEM_PROMPT` |
| Types/Interfaces | PascalCase | `AgentCapability` |
| Files (non-component) | kebab-case | `claude-agent.ts` |

#### Commit Messages (Conventional Commits)
```
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore
Example: feat(tasks): add subtask completion tracking
```

---

## 5. Folder Structure

### 5.1 Frontend (`rapitas-frontend/`)

```
src/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx          # Root layout with providers
│   ├── page.tsx            # Home page
│   ├── tasks/
│   │   ├── page.tsx
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx   # Dynamic task detail
│   ├── kanban/page.tsx
│   ├── github/
│   │   ├── page.tsx
│   │   ├── issues/page.tsx
│   │   └── pull-requests/
│   ├── approvals/
│   ├── settings/
│   │   └── developer-mode/
│   └── ...
├── components/             # Shared components
│   ├── ui/                 # Reusable UI (Button, Toast, etc.)
│   ├── Header.tsx
│   └── note/               # Note-taking with AI integration
├── feature/                # Domain modules
│   ├── tasks/
│   │   ├── components/     # TaskCard, TaskDetail, SubtaskList
│   │   ├── pomodoro/       # Pomodoro state (Zustand)
│   │   └── config/
│   └── developer-mode/
│       ├── components/     # AI panels, DiffViewer
│       └── hooks/          # useDeveloperMode, useAgentExecution
├── types/                  # TypeScript definitions
│   └── index.ts            # 70+ type definitions
└── utils/                  # Utility functions
```

### 5.2 Backend (`rapitas-backend/`)

```
├── index.ts                # Main entry (6,450 lines, all routes)
├── prisma/
│   ├── schema.prisma       # Database schema (40+ models)
│   └── migrations/
├── services/
│   ├── claude-agent.ts     # Claude API integration
│   ├── github-service.ts   # GitHub API via gh CLI
│   ├── realtime-service.ts # SSE management
│   └── agents/
│       ├── base-agent.ts           # Abstract base class
│       ├── agent-factory.ts        # Factory + registry
│       ├── agent-orchestrator.ts   # Execution orchestration
│       ├── claude-code-agent.ts    # Claude Code CLI wrapper
│       └── question-detection.ts   # User question detection
├── utils/
│   ├── encryption.ts       # AES-256-GCM for API keys
│   ├── db-init.ts          # Database initialization
│   └── tauri-init.ts       # SQLite setup for desktop
└── types/
```

### 5.3 Desktop (`rapitas-desktop/`)

```
├── src-tauri/
│   ├── src/main.rs         # Tauri entry point
│   ├── tauri.conf.json     # Tauri configuration
│   ├── capabilities/       # Permission definitions
│   ├── binaries/           # Backend binary (sidecar)
│   └── icons/              # App icons
├── scripts/                # Build scripts
└── package.json
```

---

## 6. Setup Instructions

### 6.1 Prerequisites

- **Node.js**: 20.x or later
- **pnpm**: 8.x or later (`npm install -g pnpm`)
- **Bun**: Latest (`curl -fsSL https://bun.sh/install | bash`)
- **PostgreSQL**: 15.x (for web development)
- **Rust**: 1.70+ (for desktop development)
- **gh CLI**: Latest (for GitHub operations)

### 6.2 Installation

```bash
# 1. Clone repository
git clone https://github.com/taka-y-0820/rapitas.git
cd rapitas

# 2. Install all dependencies
npm run install:all

# 3. Configure environment
# rapitas-backend/.env
DATABASE_URL="postgresql://user:password@localhost:5432/rapitas"
ENCRYPTION_KEY="your-32-byte-hex-key"
# CLAUDE_API_KEY="sk-ant-xxxxx"  # Optional, can be set via UI

# 4. Initialize database
npm run prisma:migrate

# 5. Start development servers
npm run dev
```

### 6.3 Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend |
| `npm run dev:backend` | Backend only (Bun + Elysia) |
| `npm run dev:frontend` | Frontend only (Next.js) |
| `npm run tauri` | Desktop app development |
| `npm run tauri:build` | Build desktop app |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:migrate` | Run database migrations |

### 6.4 Ports

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | Next.js development server |
| Backend | 3001 | Elysia REST API |
| Prisma Studio | 5555 | Database management UI |

---

## 7. Development Guidelines

### 7.1 Branch Strategy

```
main (master)         # Production-ready code
  └── develop         # Integration branch
        ├── feature/issue-123-add-xxx
        ├── bugfix/issue-456-fix-yyy
        └── release/v1.0.0
```

### 7.2 Workflow

1. **Create Issue** with detailed specifications
2. **Create branch** from `develop`: `feature/issue-123-description`
3. **Implement** following coding conventions
4. **Create PR** linked to Issue
5. **Code Review** by at least one team member
6. **Merge** after approval

### 7.3 Important Files to Know

| File | Purpose |
|------|---------|
| `rapitas-backend/index.ts` | All API routes (6,450 lines) |
| `rapitas-backend/prisma/schema.prisma` | Database schema |
| `rapitas-frontend/src/types/index.ts` | All TypeScript types |
| `rapitas-frontend/src/feature/developer-mode/` | AI integration |
| `.claude/CLAUDE.md` | Claude Code instructions |

---

## 8. AI Agent Best Practices

### 8.1 Claude (Anthropic)

#### Effective Prompts
```markdown
## Context
Working on Rapitas: a Next.js 16 + Elysia + Prisma task management app.

## Key Information
- Frontend: `rapitas-frontend/src/` (App Router)
- Backend: `rapitas-backend/` (Bun + Elysia)
- Database: Prisma with PostgreSQL/SQLite
- Types: `rapitas-frontend/src/types/index.ts`

## Request
[Your specific request here]
```

#### Best Practices
1. **Reference specific files** - Always mention exact paths
2. **Include types** - Rapitas has comprehensive TypeScript types
3. **Mention the layer** - Specify frontend/backend/shared
4. **Use existing patterns** - Follow established conventions
5. **Check `.claude/CLAUDE.md`** - Contains project-specific rules

#### Agent Capabilities
```typescript
type ClaudeAgentCapability = {
  codeGeneration: true;
  codeReview: true;
  taskAnalysis: true;
  fileOperations: true;
  terminalAccess: true;
  gitOperations: true;
  webSearch: true;
};
```

### 8.2 GPT-4 / ChatGPT (OpenAI)

#### Effective Prompts
```markdown
I'm working on Rapitas, a monorepo task management app with:
- Frontend: Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- Backend: Bun + Elysia + Prisma
- Desktop: Tauri (Rust)

The codebase uses TypeScript strict mode throughout.
Path alias: @/* maps to ./src/* in frontend.

[Your request]
```

#### Best Practices
1. **Provide tech stack context** - GPT needs explicit framework info
2. **Include version numbers** - Next.js 16 differs from 14
3. **Share relevant code snippets** - Context improves accuracy
4. **Ask for Bun-compatible code** - Not all Node.js patterns work

### 8.3 GitHub Copilot

#### Workspace Configuration
```json
// .vscode/settings.json
{
  "github.copilot.enable": {
    "*": true,
    "markdown": true,
    "typescript": true,
    "typescriptreact": true
  }
}
```

#### Best Practices
1. **Use descriptive function names** - Copilot learns from context
2. **Write JSDoc comments first** - Copilot uses them for generation
3. **Keep related code visible** - Open relevant files as context
4. **Use // TODO: comments** - Copilot can implement from TODO descriptions

### 8.4 Amazon CodeWhisperer

#### Best Practices
1. **Enable AWS toolkit** - Better integration with AWS services
2. **Use type annotations** - CodeWhisperer benefits from explicit types
3. **Comment the expected behavior** - Improves suggestion quality
4. **Accept partial suggestions** - Then refine manually

### 8.5 Google Gemini

#### Best Practices
1. **Provide full file context** - Gemini handles large contexts well
2. **Use structured prompts** - Markdown formatting improves responses
3. **Ask for explanations** - Good at reasoning about code
4. **Request alternatives** - Gemini can suggest multiple approaches

### 8.6 Common Patterns for All AI Agents

#### When Adding a New Feature
```markdown
## Task: Add [feature name]

## Existing Patterns to Follow
- Components: `src/feature/tasks/components/TaskCard.tsx`
- Hooks: `src/feature/developer-mode/hooks/useDeveloperMode.ts`
- API: `rapitas-backend/index.ts` (search for similar endpoints)
- Types: `src/types/index.ts`

## Requirements
1. [Requirement 1]
2. [Requirement 2]

## Constraints
- Use existing UI components from `src/components/ui/`
- Follow TypeScript strict mode
- Add types to `src/types/index.ts`
```

#### When Fixing a Bug
```markdown
## Bug Description
[Describe the issue]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]

## Expected Behavior
[What should happen]

## Relevant Files
- `path/to/relevant/file.ts`

## Error Message (if any)
```
[Error message]
```
```

---

## 9. Troubleshooting

### 9.1 Common Issues

#### Database Connection Failed
```bash
# Check PostgreSQL is running
pg_isready

# Reset database
npm run prisma:migrate reset
```

#### Bun Installation Issues
```bash
# Reinstall Bun
curl -fsSL https://bun.sh/install | bash

# Clear Bun cache
bun pm cache rm
```

#### Frontend Build Errors
```bash
# Clear Next.js cache
rm -rf rapitas-frontend/.next
pnpm install
pnpm run build
```

#### Tauri Build Fails
```bash
# Update Rust
rustup update

# Clean Tauri build
cd rapitas-desktop
cargo clean
npm run tauri build
```

### 9.2 Environment-Specific Issues

#### Windows
- Use PowerShell or Git Bash
- May need `cross-env` for environment variables
- Path separators: use forward slashes in code

#### macOS
- Install Xcode Command Line Tools
- May need Rosetta for M1/M2 chips with some dependencies

#### Linux
- Install required system libraries for Tauri
- May need `libwebkit2gtk-4.0-dev` and `libappindicator3-dev`

### 9.3 AI Agent Integration Issues

#### Claude Code Not Working
```bash
# Verify Claude CLI is installed
claude --version

# Check API key
claude auth status

# Test with simple prompt
claude "Hello, world"
```

#### GitHub Integration Fails
```bash
# Verify gh CLI authentication
gh auth status

# Re-authenticate if needed
gh auth login
```

---

## Appendix

### A. Key Type Definitions

```typescript
// Task types
interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimatedHours?: number;
  parentId?: string;
  themeId?: string;
  projectId?: string;
  milestoneId?: string;
  // ... more fields
}

// Agent types
interface AgentCapability {
  codeGeneration: boolean;
  codeReview: boolean;
  taskAnalysis: boolean;
  fileOperations: boolean;
  terminalAccess: boolean;
  gitOperations?: boolean;
  webSearch?: boolean;
}

// Approval types
interface ApprovalRequest {
  id: string;
  type: 'subtask_proposal' | 'code_review' | 'ai_action';
  status: 'pending' | 'approved' | 'rejected';
  diff?: string;
  proposedSubtasks?: SubtaskProposal[];
}
```

### B. API Response Formats

```typescript
// Success response
{ data: T, message?: string }

// Error response
{ error: string, details?: string }

// Paginated response
{ data: T[], total: number, page: number, limit: number }
```

### C. SSE Event Types

```typescript
type SSEEvent =
  | { type: 'execution_started'; payload: ExecutionStartedPayload }
  | { type: 'execution_progress'; payload: ExecutionProgressPayload }
  | { type: 'execution_completed'; payload: ExecutionCompletedPayload }
  | { type: 'execution_failed'; payload: ExecutionFailedPayload }
  | { type: 'notification'; payload: Notification };
```

---

*Generated: 2026-02-01*
*Version: 1.0.0*
*For AI Agents: Claude, GPT-4, GitHub Copilot, CodeWhisperer, Gemini*
