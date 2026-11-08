import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/api_config.dart';
import '../services/api_client.dart';
import '../services/task_service.dart';
import '../services/agent_service.dart';
import '../services/approval_service.dart';
import '../services/deploy_service.dart';
import '../services/notification_service.dart';
import '../services/sse_service.dart';
import '../services/theme_service.dart';
import 'connection_provider.dart';

// NOTE: 以前は ApiConfig() を固定で返していたため、設定画面で保存した URL が
// 再起動後に使われず、常に localhost へ繋いでいた。保存済みの接続設定から作る。
final apiConfigProvider = Provider<ApiConfig>((ref) {
  final settings = ref.watch(connectionSettingsProvider);
  return ApiConfig(baseUrl: settings.baseUrl, apiToken: settings.apiToken);
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final config = ref.watch(apiConfigProvider);
  return ApiClient(config: config);
});

final taskServiceProvider = Provider<TaskService>((ref) {
  return TaskService(ref.watch(apiClientProvider));
});

final agentServiceProvider = Provider<AgentService>((ref) {
  return AgentService(ref.watch(apiClientProvider));
});

final approvalServiceProvider = Provider<ApprovalService>((ref) {
  return ApprovalService(ref.watch(apiClientProvider));
});

final deployServiceProvider = Provider<DeployService>((ref) {
  return DeployService(ref.watch(apiClientProvider));
});

final notificationServiceProvider = Provider<NotificationService>((ref) {
  return NotificationService(ref.watch(apiClientProvider));
});

final themeServiceProvider = Provider<ThemeService>((ref) {
  return ThemeService(ref.watch(apiClientProvider));
});

/// SSE 接続。接続設定が変わるとサービスごと作り直し、新しい接続先へ繋ぎ直す。
/// 保存済み設定の読み込み前は繋がない（既定の localhost へ一瞬繋ぎに行くのを防ぐ）。
final sseServiceProvider = Provider<SseService>((ref) {
  final config = ref.watch(apiConfigProvider);
  final loaded = ref.watch(connectionSettingsProvider.select((s) => s.loaded));
  final service = SseService(config: config);
  if (loaded) service.connect();
  ref.onDispose(() => service.dispose());
  return service;
});

/// SSE の接続状態（設定画面・ホームの表示用）
final sseConnectionStateProvider = StreamProvider<SseConnectionState>((ref) {
  final service = ref.watch(sseServiceProvider);
  return service.connectionStates;
});
