import '../models/agent_config.dart';
import '../models/agent_execution.dart';
import 'api_client.dart';

class AgentService {
  final ApiClient _client;

  AgentService(this._client);

  Future<List<AgentConfig>> getAgentConfigs() async {
    final response = await _client.get('/agents');
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['agents'] ?? []);
    return data.map((json) => AgentConfig.fromJson(json)).toList();
  }

  Future<AgentConfig> getAgentConfig(String id) async {
    final response = await _client.get('/agents/$id');
    return AgentConfig.fromJson(response.data);
  }

  Future<AgentConfig> createAgentConfig({
    required String agentType,
    required String name,
    String? apiKey,
    String? endpoint,
    String? modelId,
    bool isDefault = false,
  }) async {
    final response = await _client.post('/agents', data: {
      'agentType': agentType,
      'name': name,
      if (apiKey != null) 'apiKey': apiKey,
      if (endpoint != null) 'endpoint': endpoint,
      if (modelId != null) 'modelId': modelId,
      'isDefault': isDefault,
    });
    return AgentConfig.fromJson(response.data);
  }

  Future<AgentConfig> updateAgentConfig(
    String id, {
    String? name,
    String? apiKey,
    bool? clearApiKey,
    String? endpoint,
    String? modelId,
    bool? isDefault,
    bool? isActive,
  }) async {
    final response = await _client.patch('/agents/$id', data: {
      if (name != null) 'name': name,
      if (apiKey != null) 'apiKey': apiKey,
      if (clearApiKey == true) 'clearApiKey': true,
      if (endpoint != null) 'endpoint': endpoint,
      if (modelId != null) 'modelId': modelId,
      if (isDefault != null) 'isDefault': isDefault,
      if (isActive != null) 'isActive': isActive,
    });
    return AgentConfig.fromJson(response.data);
  }

  Future<void> deleteAgentConfig(String id) async {
    await _client.delete('/agents/$id');
  }

  Future<String?> setApiKey(String id, String apiKey) async {
    final response = await _client.post('/agents/$id/api-key', data: {
      'apiKey': apiKey,
    });
    return response.data['apiKeyMasked'] as String?;
  }

  Future<void> removeApiKey(String id) async {
    await _client.delete('/agents/$id/api-key');
  }

  Future<bool> testConnection(String id) async {
    try {
      await _client.post('/agents/$id/test-connection');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<AgentExecution> executeTask(String taskId) async {
    final response = await _client.post('/agents/executions/$taskId/execute');
    return AgentExecution.fromJson(response.data);
  }

  Future<AgentExecution> getExecution(String id) async {
    final response = await _client.get('/agents/executions/$id');
    return AgentExecution.fromJson(response.data);
  }

  Future<List<AgentExecution>> getExecutions() async {
    final response = await _client.get('/agents/executions');
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['executions'] ?? []);
    return data.map((json) => AgentExecution.fromJson(json)).toList();
  }

  Future<void> cancelExecution(String id) async {
    await _client.post('/agents/executions/$id/cancel');
  }

  Future<AgentExecution> resumeExecution(String id) async {
    final response = await _client.post('/agents/executions/$id/resume');
    return AgentExecution.fromJson(response.data);
  }

  Future<List<dynamic>> getExecutionLogs(String id) async {
    final response = await _client.get('/agents/executions/$id/logs');
    return response.data is List ? response.data : (response.data['logs'] ?? []);
  }
}
