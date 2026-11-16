import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/api_client.dart';

/// 通信せずに決まったレスポンスを返す ApiClient。
/// AgentService は ApiClient をコンストラクタで受け取るので、implements で差し替えられる。
class _FakeApiClient implements ApiClient {
  final Map<String, dynamic> responses;
  final List<({String path, Map<String, dynamic>? query})> getCalls = [];

  _FakeApiClient(this.responses);

  Response<T> _respond<T>(String path) {
    if (!responses.containsKey(path)) {
      throw StateError('想定外のリクエスト: $path');
    }
    return Response<T>(
      data: responses[path] as T?,
      statusCode: 200,
      requestOptions: RequestOptions(path: path),
    );
  }

  @override
  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    getCalls.add((path: path, query: queryParameters));
    return _respond<T>(path);
  }

  @override
  Future<Response<T>> post<T>(String path,
          {dynamic data,
          Map<String, dynamic>? queryParameters,
          Duration? receiveTimeout}) async =>
      _respond<T>(path);

  @override
  Future<Response<T>> patch<T>(String path, {dynamic data}) async =>
      _respond<T>(path);

  @override
  Future<Response<T>> put<T>(String path, {dynamic data}) async =>
      _respond<T>(path);

  @override
  Future<Response<T>> delete<T>(String path) async => _respond<T>(path);

  @override
  void updateBaseUrl(String baseUrl) {}
}

void main() {
  group('AgentService.getTaskExecutionLogs', () {
    test('バックエンドの {chunk, type} を {message, level} に正規化する', () async {
      final client = _FakeApiClient({
        '/tasks/658/execution-logs': {
          'logs': [
            {
              'id': 1,
              'chunk': 'ビルドを開始します',
              'type': 'output',
              'sequence': 0,
              'timestamp': '2026-11-08T01:23:45.000Z',
            },
            {
              'id': 2,
              'chunk': 'コンパイルエラー',
              'type': 'error',
              'sequence': 1,
              'timestamp': '2026-11-08T01:23:46.000Z',
            },
          ],
        },
      });

      final logs = await AgentService(client)
          .getTaskExecutionLogs('658', executionId: '2806');

      expect(client.getCalls.single.query, {'executionId': '2806'});
      expect(logs, [
        {
          'message': 'ビルドを開始します',
          'level': 'output',
          'timestamp': '2026-11-08T01:23:45.000Z',
        },
        {
          'message': 'コンパイルエラー',
          'level': 'error',
          'timestamp': '2026-11-08T01:23:46.000Z',
        },
      ]);
    });

    test('chunk・type が欠けた行は空文字と info で補う', () async {
      final client = _FakeApiClient({
        '/tasks/658/execution-logs': {
          'logs': [
            {'id': 3, 'sequence': 2, 'timestamp': null},
          ],
        },
      });

      final logs = await AgentService(client).getTaskExecutionLogs('658');

      expect(client.getCalls.single.query, isEmpty);
      expect(logs.single, {'message': '', 'level': 'info', 'timestamp': null});
    });

    test('履歴なし（{logs: [], status: none}）は空リスト', () async {
      final client = _FakeApiClient({
        '/tasks/658/execution-logs': {'logs': <dynamic>[], 'status': 'none'},
      });

      final logs = await AgentService(client).getTaskExecutionLogs('658');

      expect(logs, isEmpty);
    });
  });

  group('AgentService.executeTask', () {
    test('success: false は AgentActionException（バックエンドの error 文面）になる',
        () async {
      final client = _FakeApiClient({
        '/tasks/658/execute': {
          'success': false,
          'error': 'このテーマは自動実行モード中です。手動実行するには自動実行を停止してください。',
          'code': 'AUTO_RUN_ACTIVE',
        },
      });

      await expectLater(
        AgentService(client).executeTask('658'),
        throwsA(isA<AgentActionException>().having(
          (e) => e.message,
          'message',
          'このテーマは自動実行モード中です。手動実行するには自動実行を停止してください。',
        )),
      );
    });
  });
}
