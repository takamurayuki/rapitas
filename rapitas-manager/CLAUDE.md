# Rapitas Manager - Flutter Mobile App

## Overview

rapitas-manager is a Flutter mobile application for managing Rapitas (Tauri desktop app) remotely from a smartphone. It connects to the rapitas-backend API (Elysia + Bun + Prisma + PostgreSQL) running on port 3001.

---

## Architecture

### Tech Stack

- **Framework**: Flutter (Dart)
- **State Management**: Riverpod 2.x
- **HTTP Client**: Dio
- **Local Storage**: shared_preferences / Hive
- **Push Notifications**: firebase_messaging (FCM)
- **Real-time Updates**: SSE (Server-Sent Events) via `eventsource` package
- **Routing**: go_router
- **Localization**: Japanese (primary), English

### Project Structure

```
rapitas-manager/
├── lib/
│   ├── main.dart
│   ├── app.dart
│   ├── config/
│   │   ├── api_config.dart          # Backend URL, timeout settings
│   │   ├── theme.dart               # Material3 theme (light/dark)
│   │   └── routes.dart              # go_router configuration
│   ├── models/                      # Data models (mirrors Prisma schema)
│   │   ├── task.dart
│   │   ├── theme_model.dart
│   │   ├── project.dart
│   │   ├── milestone.dart
│   │   ├── agent_config.dart
│   │   ├── agent_execution.dart
│   │   ├── notification.dart
│   │   ├── schedule_event.dart
│   │   ├── study_streak.dart
│   │   ├── exam_goal.dart
│   │   ├── habit.dart
│   │   ├── flashcard.dart
│   │   └── ...
│   ├── providers/                   # Riverpod providers
│   │   ├── task_provider.dart
│   │   ├── agent_provider.dart
│   │   ├── execution_provider.dart
│   │   ├── notification_provider.dart
│   │   ├── auth_provider.dart
│   │   └── ...
│   ├── services/                    # API client & business logic
│   │   ├── api_client.dart          # Dio-based HTTP client
│   │   ├── sse_service.dart         # SSE real-time connection
│   │   ├── task_service.dart
│   │   ├── agent_service.dart
│   │   ├── notification_service.dart
│   │   └── ...
│   ├── screens/                     # Full-screen pages
│   │   ├── home/
│   │   ├── task_list/
│   │   ├── task_detail/
│   │   ├── agent_execution/
│   │   ├── approvals/
│   │   ├── notifications/
│   │   ├── dashboard/
│   │   ├── calendar/
│   │   ├── settings/
│   │   └── ...
│   ├── widgets/                     # Reusable UI components
│   │   ├── task_card.dart
│   │   ├── execution_log_viewer.dart
│   │   ├── status_badge.dart
│   │   ├── priority_indicator.dart
│   │   └── ...
│   └── utils/
│       ├── date_formatter.dart
│       ├── color_utils.dart
│       └── constants.dart
├── test/
├── pubspec.yaml
├── analysis_options.yaml
└── CLAUDE.md
```

---

## Backend API (rapitas-backend)

### Connection

- **Base URL**: `http://<host>:3001` (configurable in settings)
- **Protocol**: REST (JSON) + SSE (real-time)
- **Authentication**: Currently no auth (local network use)
- **Swagger Docs**: `http://<host>:3001/api/docs`

### Core API Endpoints

#### Tasks (`/tasks`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks (filter: projectId, milestoneId, priority, status, themeId, parentId) |
| GET | `/tasks/search?q=` | Autocomplete search |
| GET | `/tasks/:id` | Get task with subtasks, timeEntries, comments, resources |
| POST | `/tasks` | Create task |
| PATCH | `/tasks/:id` | Update task (status, priority, title, etc.) |
| DELETE | `/tasks/:id` | Delete task |

#### AI Agents (`/agents`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents` | List agent configs |
| POST | `/agents` | Create agent config |
| PATCH | `/agents/:id` | Update agent config |
| DELETE | `/agents/:id` | Delete agent config |
| POST | `/agents/:id/test-connection` | Test API key connection |
| GET | `/agents/:id/audit-logs` | Get config change history |

#### Agent Execution (`/agents/executions`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/executions/:taskId/execute` | Execute task via AI agent |
| POST | `/agents/executions/:id/resume` | Resume interrupted execution |
| POST | `/agents/executions/:id/cancel` | Cancel running execution |
| GET | `/agents/executions/:id` | Get execution status & details |
| GET | `/agents/executions/:id/logs` | Get execution logs |

#### Approvals (`/approvals`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/approvals` | List pending approvals |
| GET | `/approvals/:id` | Get approval details |
| POST | `/approvals/:id/approve` | Approve request |
| POST | `/approvals/:id/reject` | Reject request (with reason) |
| POST | `/approvals/subtasks/create` | Create subtasks from AI analysis |

#### Developer Mode (`/developer-mode`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/developer-mode/config/:taskId` | Get developer mode config |
| POST | `/developer-mode/enable/:taskId` | Enable developer mode |
| DELETE | `/developer-mode/disable/:taskId` | Disable developer mode |
| POST | `/developer-mode/analyze/:taskId` | AI task analysis (breakdown) |
| POST | `/developer-mode/generate-prompt` | Generate optimized prompt |

#### Themes (`/themes`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/themes` | List all themes |
| POST | `/themes` | Create theme |
| PATCH | `/themes/:id` | Update theme |
| DELETE | `/themes/:id` | Delete theme |

#### Projects (`/projects`) & Milestones (`/milestones`)

- Standard CRUD for projects and milestones

#### Notifications (`/notifications`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications` | List notifications |
| PATCH | `/notifications/:id/read` | Mark as read |
| DELETE | `/notifications/:id` | Delete notification |

#### Schedule Events (`/schedules`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/schedules` | List events (filter by date range) |
| POST | `/schedules` | Create event |
| PATCH | `/schedules/:id` | Update event |
| DELETE | `/schedules/:id` | Delete event |

#### Statistics & Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/statistics` | Dashboard statistics |
| GET | `/reports` | Various analytics reports |

#### Study Features

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/exam-goals` | Exam goal CRUD |
| GET/POST | `/study-streaks` | Study streak CRUD |
| GET | `/study-streaks/current` | Current streak info |
| GET/POST | `/study-plans` | Study plan CRUD |
| POST | `/study-plans/:id/apply` | Apply plan (create tasks) |
| GET/POST | `/flashcards/decks` | Flashcard deck CRUD |
| GET/POST | `/habits` | Habit CRUD + logging |
| GET | `/achievements` | Achievement gallery |

#### Real-time (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/events/stream` | Main SSE stream |
| GET | `/events/subscribe/:channel` | Channel-specific SSE |

**SSE Event Types**: `execution-update`, `execution-log`, `notification`, `task-update`, `approval-request`, `question-asked`

#### AI Chat (`/ai`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/chat` | Send message (non-streaming) |
| POST | `/ai/chat/stream` | Send message (SSE streaming) |
| GET | `/ai/providers` | Get available AI providers |

#### Settings (`/settings`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings` | Get user settings |
| PATCH | `/settings` | Update settings |

#### GitHub Integration (`/github`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/github/status` | Check gh CLI status |
| GET | `/github/integrations` | List integrations |
| GET | `/github/integrations/:id/pull-requests` | List PRs |
| GET | `/github/integrations/:id/issues` | List issues |

---

## Database Models (Prisma Schema Reference)

### Task

```
id, title, description, status (todo/in-progress/done), priority (low/medium/high/urgent),
labels (JSON), estimatedHours, actualHours, dueDate, subject, startedAt, completedAt,
parentId (hierarchy), themeId, projectId, milestoneId, examGoalId,
isDeveloperMode, isAiTaskAnalysis, agentGenerated, agentExecutable,
autoExecutable, requireApproval (always/major_only/never), executionInstructions,
githubIssueId, githubPrId, createdAt, updatedAt
```

### AgentExecution

```
id, sessionId, agentConfigId, command, status (pending/running/completed/failed/cancelled/interrupted),
output, artifacts (JSON), startedAt, completedAt, tokensUsed, executionTimeMs,
errorMessage, question, questionType, questionDetails (JSON), claudeSessionId
```

### ApprovalRequest

```
id, configId, requestType, title, description, proposedChanges (JSON),
status (pending/approved/rejected/expired), expiresAt, approvedAt, rejectedAt, rejectionReason
```

### Notification

```
id, type, title, message, link, isRead, readAt, metadata (JSON), createdAt
```

### ScheduleEvent

```
id, title, description, startAt, endAt, isAllDay, color,
reminderMinutes, reminderSentAt, taskId, createdAt, updatedAt
```

---

## Core Features (Mobile App)

### 1. Task Management (Priority: High)

- Task list with filtering (status, priority, theme, project)
- Task detail view with subtask hierarchy
- Quick task creation
- Status change (swipe actions: todo -> in-progress -> done)
- Priority change
- Due date management
- Theme/project assignment

### 2. AI Agent Execution & Monitoring (Priority: High)

- View running executions in real-time (SSE streaming)
- Execute tasks via AI agent (trigger from mobile)
- View execution logs (streaming)
- Cancel running executions
- Resume interrupted executions
- Answer agent questions (when AI asks for clarification)
- Token usage and execution time display

### 3. Approval Workflow (Priority: High)

- Push notification for new approval requests
- View proposed changes (diff view)
- Approve/reject from mobile
- Approval history

### 4. Notifications (Priority: High)

- Real-time push notifications via FCM
- In-app notification center
- Notification types: execution complete, approval needed, question asked, task updates
- Badge count on app icon

### 5. Dashboard & Statistics (Priority: Medium)

- Task completion statistics
- Today's summary
- Active executions overview
- Study streak display
- Burndown chart (simple)

### 6. Calendar & Schedule (Priority: Medium)

- Calendar view of scheduled events
- Quick event creation
- Reminders (local notifications)
- Task due date visualization

### 7. Study Features (Priority: Medium)

- Exam goal countdown
- Study streak tracking
- Flashcard review (spaced repetition)
- Habit check-in

### 8. GitHub Integration (Priority: Low)

- View PR status
- View issue list
- Quick PR approval (via GitHub API)

---

## Recommended Additional Features for Mobile

### Quick Actions & Widgets

- **Home Screen Widget**: Display today's tasks, active executions, pending approvals
- **Quick Actions (3D Touch / Long Press)**: Create task, check approvals, view executions
- **Share Extension**: Share text/URL to create a task

### Mobile-Specific Features

- **Offline Mode**: Cache recent tasks for offline viewing, queue changes for sync
- **Biometric Auth**: Fingerprint/Face ID for app access (API keys are sensitive)
- **Voice Input**: Voice-to-task creation using speech recognition
- **Camera Integration**: Attach photos to tasks directly from camera
- **QR Code Scanner**: Scan QR to connect to backend server

### Enhanced Monitoring

- **Execution Timeline**: Visual timeline of all agent executions
- **Resource Monitor**: Token usage charts, API cost tracking
- **Activity Feed**: Chronological feed of all system events

### Smart Features

- **Smart Notifications**: Priority-based notification filtering
- **Batch Operations**: Multi-select tasks for bulk status changes
- **Search**: Full-text search across tasks, comments, execution logs
- **Favorites**: Pin frequently accessed tasks

---

## Development Guidelines

### Code Style

- Follow Dart/Flutter official style guide
- Use `analysis_options.yaml` with strict rules
- File names in snake_case
- Class names in PascalCase
- Variable/function names in camelCase
- Constants in camelCase (Dart convention)

### State Management (Riverpod)

- Use `@riverpod` annotation (code generation) for providers
- AsyncNotifier for API-driven state
- StateNotifier for local UI state
- Keep providers focused and composable

### API Client Pattern

```dart
// Centralized Dio instance with interceptors
class ApiClient {
  late final Dio _dio;

  ApiClient({required String baseUrl}) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: Duration(seconds: 10),
      receiveTimeout: Duration(seconds: 30),
    ));
    _dio.interceptors.add(LogInterceptor());
  }
}
```

### Error Handling

- Use `Result<T>` pattern or `Either<Failure, T>` for API calls
- Show user-friendly error messages (Japanese)
- Retry logic for transient network errors
- Graceful degradation when backend is unreachable

### Testing

- Unit tests for services and providers
- Widget tests for key screens
- Integration tests for critical flows (task CRUD, execution trigger)
- Minimum 80% test coverage target

### Backend Communication

- **Important**: The backend runs on the user's local network. The mobile app must allow configuring the backend URL.
- Support mDNS/Bonjour for automatic backend discovery on local network
- Handle network transitions (Wi-Fi -> cellular) gracefully
- SSE reconnection with exponential backoff

### Localization

- Primary language: Japanese
- UI text in Japanese by default
- Error messages in Japanese
- Date/time format: Japanese locale (yyyy/MM/dd, HH:mm)

---

## Constraints & Important Notes

### Backend Compatibility

- The backend is shared with rapitas-frontend (Next.js) and rapitas-desktop (Tauri)
- **Do NOT modify the backend API** - the mobile app must adapt to existing endpoints
- If new endpoints are needed, they should be added to rapitas-backend separately
- Backend uses Bun runtime + Elysia framework + Prisma ORM + PostgreSQL

### Security

- API keys (Claude, ChatGPT, Gemini) are encrypted in the database - never expose raw keys in mobile app
- Backend currently has no authentication - consider adding API key or JWT auth for remote access
- Store backend URL and connection settings securely (flutter_secure_storage)

### Performance

- Minimize API calls - use caching and pagination
- SSE connection should be managed as a singleton
- Lazy-load screens and data
- Image caching for task attachments

### Platform Support

- Target: iOS 15+ and Android 10+
- Material 3 design with platform-adaptive components
- Support both portrait and landscape orientations
- Responsive layout for phones and tablets
