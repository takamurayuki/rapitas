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
