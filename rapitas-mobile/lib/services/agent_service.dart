import 'package:dio/dio.dart';
import '../models/agent_config.dart';
import '../models/task_execution.dart';
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

  // ---- 実行系（タスク中心の実在API） ----
  //
  // バックエンドは失敗を HTTP ステータスだけでなく body の success / error でも返す
  // （レート制限や worktree 作成失敗は 200 のまま success が無い / false）。
  // そのため成否は必ず body で判定し、失敗時は error（無ければ message）を
  // 本文とする AgentActionException を投げる。4xx/5xx で Dio が投げた例外も、
  // body に error があればその文面に置き換える。

  /// POST /tasks/:id/execute（body は全フィールド任意。{} を送る）
  Future<TaskExecutionStart> executeTask(String taskId) async {
    final data = await _postAction('/tasks/$taskId/execute', fallbackError: '実行を開始できませんでした');
    return TaskExecutionStart.fromJson(data, taskId: taskId);
  }

  /// POST /tasks/:id/stop-execution
  Future<void> stopTaskExecution(String taskId) async {
    await _postAction('/tasks/$taskId/stop-execution', fallbackError: '停止できませんでした');
  }

  /// POST /agents/executions/:id/resume
  Future<void> resumeExecution(String executionId) async {
    await _postAction('/agents/executions/$executionId/resume', fallbackError: '再開できませんでした');
  }

  /// GET /tasks/executing
  Future<List<ExecutingTask>> getExecutingTasks() async {
    final response = await _client.get('/tasks/executing');
    final data = response.data;
    if (data is! List) {
      throw const FormatException('/tasks/executing が配列を返しませんでした');
    }
    return data
        .map((json) => ExecutingTask.fromJson(Map<String, dynamic>.from(json as Map)))
        .toList();
  }

  /// GET /agents/resumable-executions
  /// DB 障害時は 503 + [] が返る。Dio が 503 で例外を投げるので、そのまま失敗として扱う。
  Future<List<ResumableExecution>> getResumableExecutions() async {
    final response = await _client.get('/agents/resumable-executions');
    final data = response.data;
    if (data is! List) {
      throw const FormatException('/agents/resumable-executions が配列を返しませんでした');
    }
    return data
        .map((json) => ResumableExecution.fromJson(Map<String, dynamic>.from(json as Map)))
        .toList();
  }

  /// GET /tasks/:id/execution-logs（executionId 指定で単一実行モード）
  ///
  /// バックエンドのログは {id, chunk, type, sequence, timestamp}。ExecutionLogViewer は
  /// message / level を読むので {message, level, timestamp} に正規化して返す。
  /// 履歴なしは {logs: [], status: 'none'} なので空リストになる。
  Future<List<Map<String, dynamic>>> getTaskExecutionLogs(
    String taskId, {
    String? executionId,
  }) async {
    final response = await _client.get(
      '/tasks/$taskId/execution-logs',
      queryParameters: {if (executionId != null) 'executionId': executionId},
    );
    final data = response.data;
    final List<dynamic> logs = data is Map ? (data['logs'] as List? ?? const []) : const [];
    return logs.whereType<Map>().map((log) {
      return <String, dynamic>{
        'message': log['chunk']?.toString() ?? '',
        'level': log['type']?.toString() ?? 'info',
        'timestamp': log['timestamp'],
      };
    }).toList();
  }

  Future<Map<String, dynamic>> _postAction(
    String path, {
    required String fallbackError,
  }) async {
    final Map<String, dynamic> body;
    try {
      final response = await _client.post(path, data: <String, dynamic>{});
      body = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : <String, dynamic>{};
    } on DioException catch (e) {
      final message = _errorMessageOf(e.response?.data);
      if (message != null) throw AgentActionException(message);
      rethrow;
    }
    if (body['success'] != true) {
      throw AgentActionException(_errorMessageOf(body) ?? fallbackError);
    }
    return body;
  }

  static String? _errorMessageOf(dynamic data) {
    if (data is! Map) return null;
    for (final key in const ['error', 'message']) {
      final value = data[key];
      if (value is String && value.isNotEmpty) return value;
    }
    return null;
  }
}

/// 実行系の操作が失敗したときの例外。toString はバックエンドの文面そのもの
/// （呼び出し側の「実行に失敗しました: $e」にそのまま入る）。
class AgentActionException implements Exception {
  final String message;

  const AgentActionException(this.message);

  @override
  String toString() => message;
}
