import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/agent_execution.dart';
import 'service_providers.dart';

final executionListProvider = FutureProvider<List<AgentExecution>>((ref) async {
  final service = ref.watch(agentServiceProvider);
  return service.getExecutions();
});

final executionDetailProvider = FutureProvider.family<AgentExecution, String>((ref, id) async {
  final service = ref.watch(agentServiceProvider);
  return service.getExecution(id);
});

final executionLogsProvider = FutureProvider.family<List<dynamic>, String>((ref, id) async {
  final service = ref.watch(agentServiceProvider);
  return service.getExecutionLogs(id);
});
