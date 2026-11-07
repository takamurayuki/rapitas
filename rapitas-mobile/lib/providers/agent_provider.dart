import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/agent_config.dart';
import 'service_providers.dart';

final agentConfigsProvider =
    AsyncNotifierProvider<AgentConfigsNotifier, List<AgentConfig>>(
  AgentConfigsNotifier.new,
);

class AgentConfigsNotifier extends AsyncNotifier<List<AgentConfig>> {
  @override
  Future<List<AgentConfig>> build() async {
    return ref.read(agentServiceProvider).getAgentConfigs();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(
      () => ref.read(agentServiceProvider).getAgentConfigs(),
    );
  }

  Future<void> setApiKey(String configId, String apiKey) async {
    await ref.read(agentServiceProvider).setApiKey(configId, apiKey);
    await refresh();
  }

  Future<void> removeApiKey(String configId) async {
    await ref.read(agentServiceProvider).removeApiKey(configId);
    await refresh();
  }

  Future<bool> testConnection(String configId) async {
    return ref.read(agentServiceProvider).testConnection(configId);
  }

  Future<void> updateConfig(
    String configId, {
    String? name,
    String? endpoint,
    String? modelId,
    bool? isDefault,
    bool? isActive,
  }) async {
    await ref.read(agentServiceProvider).updateAgentConfig(
          configId,
          name: name,
          endpoint: endpoint,
          modelId: modelId,
          isDefault: isDefault,
          isActive: isActive,
        );
    await refresh();
  }

  Future<void> createConfig({
    required String agentType,
    required String name,
    String? apiKey,
    String? endpoint,
    String? modelId,
  }) async {
    await ref.read(agentServiceProvider).createAgentConfig(
          agentType: agentType,
          name: name,
          apiKey: apiKey,
          endpoint: endpoint,
          modelId: modelId,
        );
    await refresh();
  }

  Future<void> deleteConfig(String configId) async {
    await ref.read(agentServiceProvider).deleteAgentConfig(configId);
    await refresh();
  }
}
