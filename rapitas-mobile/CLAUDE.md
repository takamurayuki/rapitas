# Rapitas Mobile - Flutter Mobile App

## Overview

rapitas-mobile is a Flutter app for using Rapitas from a phone. It talks to the same rapitas-backend API (Elysia + Bun + Prisma ORM, PostgreSQL (web) / SQLite (desktop)) that the desktop app runs. Agents themselves always run on the desktop; the phone views and operates tasks, executions, approvals and the Rapi assistant chat.

The UI is Japanese only. User-facing strings are written directly in the widgets.

---

## Architecture

### Tech Stack

Taken from `pubspec.yaml`.

| Concern | Package / approach |
| --- | --- |
| Framework | Flutter (Dart SDK ^3.6.1) |
| State management | flutter_riverpod 2.x (providers are written by hand; `riverpod_annotation` / `riverpod_generator` are declared but not used) |
| HTTP client | dio |
| Routing | go_router (`lib/config/routes.dart`) |
| Settings storage | shared_preferences (backend URL, paired desktop id/name, theme mode, voice mode, Rapi drafts) |
| Secret storage | flutter_secure_storage (API / device token) |
| Real-time updates | SSE over Dio streaming (`lib/services/sse_service.dart`, parser in `lib/services/sse_parser.dart`) |
| QR pairing | mobile_scanner |
| LAN discovery | bonsoir (mDNS service `_rapitas._tcp`) |
| Voice input | speech_to_text |
| Markdown / assets | flutter_markdown_plus, flutter_svg, url_launcher |
| Date formatting | intl |

`json_annotation`, `freezed_annotation`, `freezed`, `json_serializable` and `connectivity_plus` are also declared, but no code in `lib/` uses them today. Models have hand-written `fromJson` / `toJson`.

There is no push notification (FCM or otherwise) and no local database. Notifications are fetched from the backend and refreshed over SSE while the app is running.

### Project Structure

```
rapitas-mobile/
├── lib/
│   ├── main.dart                  ProviderScope + RapitasMobileApp
│   ├── app.dart                   MaterialApp.router; starts the long-lived providers
│   ├── config/
│   │   ├── api_config.dart        Base URL normalisation, timeouts, auth headers, SSE path
│   │   ├── routes.dart            go_router routes, bottom navigation shell, deep links
│   │   ├── note_paths.dart / note_routes.dart
│   │   └── theme.dart             Material 3 light/dark themes
│   ├── models/                    Plain Dart classes with fromJson
│   │   ├── task.dart              Task, TaskCategory, TaskTheme, ThemeCategoryGroup
│   │   ├── task_execution.dart    ExecutingTask, ResumableExecution, TaskExecutionStart
│   │   ├── agent_config.dart, approval_request.dart, notification_model.dart
│   │   ├── backlog.dart           Idea, Concern, Hypothesis
│   │   ├── note.dart, companion_digest.dart, project.dart (unused)
│   │   ├── rapi.dart, rapi_companion.dart, rapi_criteria_change.dart, rapi_criteria_edit.dart
│   │   └── rapi_chat/             Chat message, cards, snapshot encode/decode
│   ├── providers/                 Riverpod providers
│   │   ├── service_providers.dart ApiConfig / ApiClient / service instances
│   │   ├── connection_provider.dart   URL, token and paired desktop
│   │   ├── pairing_provider.dart  Pairing service, LAN re-discovery
│   │   ├── realtime_refresh_provider.dart  SSE event -> provider invalidation
│   │   ├── task_provider.dart, agent_provider.dart, execution_provider.dart, approval_provider.dart
│   │   ├── notification_provider.dart, backlog_provider.dart, note_provider.dart, theme_data_provider.dart
│   │   ├── companion_provider.dart, home_widget_sync_provider.dart, pending_request_provider.dart
│   │   ├── rapi_chat_provider.dart, rapi_chat_spaces_provider.dart (+ rapi_chat/*.part.dart)
│   │   ├── settings_provider.dart theme mode, voice command mode
│   │   └── voice_provider.dart, voice_learning_provider.dart, filter_selection_provider.dart
│   ├── services/                  API clients and non-UI logic
│   │   ├── api_client.dart        Shared Dio wrapper
│   │   ├── human_decision_client.dart  Separate Dio for human-only workflow routes
│   │   ├── task_service.dart, agent_service.dart, approval_service.dart, notification_service.dart
│   │   ├── theme_service.dart, category_service.dart, backlog_service.dart, note_service.dart
│   │   ├── decision_service.dart, deploy_service.dart
│   │   ├── assistant_service.dart, companion_digest_service.dart, rapi_chat_space_service.dart
│   │   ├── sse_service.dart, sse_parser.dart
│   │   ├── pairing/               pairing_payload.dart, pairing_service.dart, desktop_discovery.dart
│   │   ├── home_screen_bridge.dart, external_draft_inbox.dart   iOS widget / Shortcut bridge
│   │   └── voice_*.dart, dictation_*.dart   Voice commands and dictation
│   ├── screens/
│   │   ├── home/  task_list/  task_detail/  task_form/  decision/
│   │   ├── agent_execution/  approvals/  notifications/  dashboard/
│   │   ├── themes/  categories/  backlog/  notes/  rapi/
│   │   ├── pairing/               QR scanner
│   │   └── settings/              Connection, agent configs, voice settings
│   ├── widgets/                   Shared widgets (task_card, status_badge, execution_log_viewer,
│   │                              app_drawer, voice_mode_*, markdown/, ...)
│   └── utils/                     color_utils, constants, date_formatter, plain_reasons
├── test/                          config/ models/ providers/ screens/ services/ widgets/ support/
├── ios/                           Runner (incl. Shortcut intents) and RapiWidget (home screen widget)
├── android/
├── pubspec.yaml
└── analysis_options.yaml
```

### Navigation

The bottom navigation bar has five tabs: ホーム (`/`), タスク (`/tasks`), 実行 (`/executions`), 承認 (`/approvals`) and チャット (`/rapi`). Everything else is reached from the drawer (`lib/widgets/app_drawer.dart`): テーマ, カテゴリ, アイデア, 懸念, 仮説, ノート, ダッシュボード, 通知, 設定.

Deep links use `rapitas://app/<path>`; for example `rapitas://app/rapi?compose=1` opens the chat with the input focused. Pairing QR codes use `rapitas://pair?d=<payload>`.

---

## Implemented Screens

| Screen | Folder under `lib/screens/` | What it does |
| --- | --- | --- |
| Home | `home/` | In-progress tasks, running agents, pending approvals, unread count |
| Task list | `task_list/` | Task list with a filter sheet (category, theme, status, priority) |
| Task detail | `task_detail/` | Description (Markdown), subtasks, inline edits, linked notes, execute / stop / resume controls |
| Task form | `task_form/` | Create and edit tasks |
| Decision | `decision/` | Plan approval, revise-plan request, answer an agent question, resolve a review hold, release a halt (`/tasks/:id/decide`) |
| Executions | `agent_execution/` | Running and resumable executions, execution logs |
| Approvals | `approvals/` | Approve or reject approval requests (with an optional reason) |
| Notifications | `notifications/` | Notification list, mark as read, delete |
| Dashboard | `dashboard/` | Task counts by status (未着手 / 進行中 / 完了 / 合計), computed on the phone from the task list |
| Themes / categories | `themes/`, `categories/` | CRUD, reorder, set default |
| Backlog | `backlog/` | Ideas (CRUD, filter), concerns (create, delete), hypotheses (status override, delete) |
| Notes | `notes/` | List, view, create and edit notes; link a note to a task |
| Rapi chat | `rapi/` | Assistant chat with multiple conversation spaces, task drafts, criteria and roadmap cards, tidy/delete proposals, companion digest |
| Pairing | `pairing/` | QR scanner that pairs the phone with a desktop |
| Settings | `settings/` | Connection (pair, manual URL and token, re-discover, connection test, restart desktop backend), AI agent configs, theme mode, voice command mode, voice learning |

On iOS there is also a home screen widget (`ios/RapiWidget/`) that shows a snapshot of approvals, executions and today's tasks, and a Shortcut ("ラピに依頼") that hands a request to the app. Both talk to Dart through `lib/services/home_screen_bridge.dart` (MethodChannel `rapitas/home_screen`); on Android the bridge does nothing.

---

## Backend Connection

### Two ways to connect

| Method | Phone talks to | Token | Where it comes from |
| --- | --- | --- | --- |
| QR pairing (LAN) | The mobile gateway on the desktop (default port 3002, all interfaces) | Per-device token | Issued by `POST /mobile-link/claim` |
| Manual URL + token | The main API on port 3001, exposed via `RAPITAS_BIND_HOST` or `tailscale serve` | `RAPITAS_API_TOKEN` | Typed into Settings |

The main API binds to 127.0.0.1 unless `RAPITAS_BIND_HOST` and `RAPITAS_API_TOKEN` are both set; when the token is set, every request must carry it (`rapitas-backend/middleware/local-auth.ts`). The mobile gateway accepts only requests that carry a paired device token, except the claim itself (`rapitas-backend/services/mobile-link/mobile-gateway.ts`). Phone linking must be enabled on the desktop (the claim returns 503 otherwise).

Either way the app sends `Authorization: Bearer <token>` on REST and SSE (`lib/config/api_config.dart`). The SSE URL never contains the token.

### Pairing flow

1. The desktop shows a QR code from its phone-link settings. The payload (`lib/services/pairing/pairing_payload.dart`, mirrored by `rapitas-backend/services/mobile-link/pairing-payload.ts`) holds the desktop id and name, the gateway port, its LAN addresses, a one-time code and an expiry.
2. `PairingService` (`lib/services/pairing/pairing_service.dart`) posts the code to `/mobile-link/claim` on each LAN address in turn and keeps the first that answers 201 with a token.
3. `ConnectionSettingsNotifier.savePairing` stores the URL, desktop id and desktop name in shared_preferences and the token in flutter_secure_storage.
4. On startup and whenever SSE starts reconnecting, `desktopRelocatorProvider` (`lib/providers/pairing_provider.dart`) looks for the paired desktop on the LAN via mDNS (`_rapitas._tcp`, TXT `id` must match) and updates the URL if its IP changed. It runs at most once a minute.

Saving a URL by hand clears the paired desktop id and name, because the manual target is not necessarily that desktop.

### Storage

| Value | Store | Key |
| --- | --- | --- |
| Backend URL | shared_preferences | `backendUrl` |
| Paired desktop id / name | shared_preferences | `pairedDesktopId`, `pairedDesktopName` |
| API or device token | flutter_secure_storage | `rapitasApiToken` |

### Endpoints the app calls

This is the full list from `lib/services/` (all relative to the base URL). Do not assume other backend routes are wired up in the app.

| Area | Endpoints |
| --- | --- |
| Tasks | `GET /tasks`, `GET /tasks/search?q=`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id` |
| Execution | `POST /tasks/:id/execute`, `POST /tasks/:id/stop-execution`, `POST /agents/executions/:id/resume`, `GET /tasks/executing`, `GET /agents/resumable-executions`, `GET /tasks/:id/execution-logs` |
| Agent configs | `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`, `POST/DELETE /agents/:id/api-key`, `POST /agents/:id/test-connection` |
| Approvals | `GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` |
| Workflow decisions | `GET /workflow/tasks/:id/files/:fileType`, `GET /workflow/tasks/:id/review-hold`, `POST /workflow/tasks/:id/approve-plan`, `.../revise-plan`, `.../answer-question`, `.../review-hold/resolve`, `.../release-halt` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `DELETE /notifications/:id` |
| Themes | `GET/POST /themes`, `PATCH/DELETE /themes/:id`, `PATCH /themes/:id/set-default`, `PATCH /themes/reorder` |
| Categories | `GET/POST /categories`, `PATCH/DELETE /categories/:id`, `GET /categories/default-category`, `PATCH /categories/:id/set-default`, `PATCH /categories/reorder` |
| Backlog | `GET/POST /idea-box`, `PATCH/DELETE /idea-box/:id`, `GET/POST /concerns`, `DELETE /concerns/:id`, `GET /hypotheses`, `PUT /hypotheses/:id/status`, `DELETE /hypotheses/:id` |
| Notes | `GET /notes`, `GET/PUT/DELETE /notes/:id`, `POST /notes/:id/links` |
| Rapi assistant | `POST /assistant/route`, `/assistant/task-draft`, `/assistant/task-create`, `/assistant/ask`, `GET /assistant/supervision`, `POST /assistant/update-draft`, `/assistant/task-update` (+ `/revert`), `/assistant/criteria-draft`, `/assistant/task-criteria` (+ `/revert`), `/assistant/criteria/review`, `/assistant/companion/draft`, `/assistant/companion/start`, `/assistant/companion/stop`, `/assistant/roadmap/draft`, `/assistant/roadmap/commit`, `/assistant/delete-filter`, `/assistant/delete-draft`, `/assistant/task-delete`, `POST /task-trash/:id/restore` |
| Companion digest | `GET /assistant/companion/digest`, `POST /assistant/companion/digest/seen` |
| Copilot chat | `POST /copilot/chat`, `GET /copilot/chat/:id/history` |
| Chat spaces | `GET/POST /rapi-chat/spaces`, `DELETE /rapi-chat/spaces/:id`, `GET/PUT /rapi-chat/spaces/:id/messages` |
| System | `GET /settings` (connection test), `GET /deploy/status`, `POST /deploy/now` (restart the desktop backend) |
| Pairing | `POST /mobile-link/claim` |
| Real-time | `GET /events/stream` (SSE) |

`POST /tasks/:id/execute` is served by `rapitas-backend/routes/agents/execution/routes/execute-route.ts`. Execution actions report failure in the body (`success` / `error`) even on HTTP 200, so `AgentService` checks the body and throws `AgentActionException`.

The workflow decision routes reject calls without `X-Rapitas-Source: ui|operator`. Only `HumanDecisionClient` (`lib/services/human_decision_client.dart`) adds that header, and only for those routes. Do not add it to `ApiClient` defaults and do not use `HumanDecisionClient` from the Rapi chat code, or the backend can no longer tell a human decision from an assistant action.

Swagger docs for the whole backend are at `http://<host>:3001/api/docs`.

### Real-time (SSE)

`SseService` connects to `/events/stream`, reconnects with exponential backoff from 1 s to 30 s, and reconnects if no event (including `ping`) arrives for 150 s. `realtimeRefreshProvider` (`lib/providers/realtime_refresh_provider.dart`) maps events to the lists it reloads:

| Event | Reloads |
| --- | --- |
| `task_created`, `task_updated`, `task_completed`, `subtasks_created` | tasks |
| `execution_status` | executions, tasks |
| `new_notification` | notifications, approvals |
| `phase_transition` | tasks, approvals |
| `auto_run_update` | tasks, executions |

Events are emitted by `rapitas-backend/services/communication/realtime-service.ts` and its callers. There is no dedicated approval event.

### Data models

Mobile models are hand-written subsets of the backend responses, not mirrors of the Prisma schema. When a field is in doubt, read the backend route's response and the Prisma models in `rapitas-backend/prisma/schema/` (for example `core.prisma` for tasks, themes and categories, `agents.prisma` for agent configs and executions, `notes.prisma`, `rapi-chat.prisma`, `workflow.prisma`).

---

## Development Guidelines

### Code Style

- Follow the Dart style guide. `analysis_options.yaml` includes the flutter_lints recommended set with no extra rules; run `flutter analyze`.
- File names in snake_case, classes in PascalCase, variables and functions in camelCase, constants in camelCase (Dart convention).
- Comments in this package are mostly Japanese; keep the existing language of a file.

### State Management (Riverpod)

- Providers are declared by hand, not with `@riverpod` code generation.
- Service instances come from `lib/providers/service_providers.dart`. `apiConfigProvider` is built from `connectionSettingsProvider`, so changing the URL or token rebuilds `ApiClient` and every service.
- API-backed reads use `FutureProvider` / `FutureProvider.family` (and `autoDispose` where appropriate); mutable state uses `StateNotifierProvider`, `NotifierProvider` or `AsyncNotifierProvider`.
- Long-lived background providers (realtime refresh, desktop relocator, home widget sync, companion digest, chat space boot) are watched once in `lib/app.dart`.

### API Client Pattern

`ApiClient` (`lib/services/api_client.dart`) wraps one Dio instance built by `ApiClient.createDio(config)`:

```dart
final dio = Dio(BaseOptions(
  baseUrl: config.baseUrl,
  connectTimeout: ApiConfig.connectTimeout, // 10 s
  receiveTimeout: ApiConfig.receiveTimeout, // 30 s, overridable per request
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...config.authHeaders, // Authorization: Bearer <token> when set
  },
));
if (kDebugMode) {
  dio.interceptors.add(LogInterceptor(requestBody: false, responseBody: false /* ... */));
}
```

Services take an `ApiClient` in their constructor and return models. The logging interceptor is debug-only and never logs headers or bodies; keep it that way.

### Error Handling

- There is no `Result` / `Either` type. Services throw: `DioException` for transport and HTTP errors, and typed exceptions for domain failures (`AgentActionException`, `PairingException`, `DeployException`, `AssistantException`), whose `toString()` is a Japanese message fit to show.
- Screens render `AsyncValue` with an error state and a 再試行 (retry) action, or show a SnackBar.
- When the backend reports failure in the body, read `error` (then `message`) rather than trusting the HTTP status.

### Testing

- Run `flutter test`. Tests live in `test/`, split into `config/`, `models/`, `providers/`, `screens/`, `services/`, `widgets/`, with fakes and harnesses in `test/support/`.
- Unit tests cover services and providers; widget tests cover screens and shared widgets. There is no integration_test directory and no coverage gate for this package.
- New behaviour should ship with a test, following the repository's TDD rule.

### Localization

- Japanese only. `MaterialApp.router` uses `locale: Locale('ja', 'JP')`; there is no l10n framework and no English translation.
- Error messages are in Japanese.
- Dates use `lib/utils/date_formatter.dart`: `yyyy/MM/dd`, `yyyy/MM/dd HH:mm`, `HH:mm`.

---

## Constraints & Important Notes

### Backend Compatibility

- The backend is shared with rapitas-frontend (Next.js) and rapitas-desktop (Tauri).
- The mobile app adapts to existing endpoints. If it needs a new endpoint, add it to rapitas-backend as a separate change.
- `PairingPayload` must stay in sync with `rapitas-backend/services/mobile-link/pairing-payload.ts`; bump `v` for incompatible changes.

### Security

- The token can trigger agent execution, which amounts to code execution on the desktop. Keep it in flutter_secure_storage only; never put it in URLs, logs, the iOS widget snapshot or shared_preferences.
- Agent API keys are sent to the backend and only a masked value (`apiKeyMasked`) comes back; never store or display raw keys in the app.
- Plain `http` is allowed on Android only in debug builds (`android/app/src/debug/AndroidManifest.xml`), so Android release builds can connect only over HTTPS (for example `tailscale serve`); QR pairing, which uses `http` on the LAN, does not work there. iOS allows local-network `http` through `NSAllowsLocalNetworking` in `ios/Runner/Info.plist`.

### Platform Support

- iOS deployment target 15.0 for the app (the widget extension targets 16.1). Android uses Flutter's default `minSdk` / `targetSdk`.
- Material 3 themes (light, dark, follow system).
