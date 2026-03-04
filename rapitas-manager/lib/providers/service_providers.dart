import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/api_config.dart';
import '../services/api_client.dart';
import '../services/task_service.dart';
import '../services/agent_service.dart';
import '../services/approval_service.dart';
import '../services/notification_service.dart';
import '../services/sse_service.dart';
import '../services/theme_service.dart';

final apiConfigProvider = Provider<ApiConfig>((ref) {
  return ApiConfig();
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

final notificationServiceProvider = Provider<NotificationService>((ref) {
  return NotificationService(ref.watch(apiClientProvider));
});

final themeServiceProvider = Provider<ThemeService>((ref) {
  return ThemeService(ref.watch(apiClientProvider));
});

final sseServiceProvider = Provider<SseService>((ref) {
  final config = ref.watch(apiConfigProvider);
  final service = SseService(config: config);
  ref.onDispose(() => service.dispose());
  return service;
});
