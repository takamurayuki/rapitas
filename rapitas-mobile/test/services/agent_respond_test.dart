/// AgentService.respondToAgent（POST /tasks/:id/agent-respond）の契約テスト。
/// バックエンドは成功で {success: true, ...}、失敗で 400/404/409/422/500 + {error} を返す
/// （rapitas-backend/routes/agents/execution/routes/respond-route.ts）。
library;

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/api_client.dart';

/// post の path と data を記録し、決めた応答を返す（または投げる）ApiClient。
class _RecordingClient implements ApiClient {
  final List<({String path, dynamic data})> posts = [];
  final Object Function(String path) reply;

  _RecordingClient(this.reply);

  @override
  Future<Response<T>> post<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    posts.add((path: path, data: data));
    final result = reply(path);
    if (result is Exception) throw result;
    return Response<T>(data: result as T?, statusCode: 200, requestOptions: RequestOptions(path: path));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

DioException _httpError(String path, int status, Map<String, dynamic> body) {
  final options = RequestOptions(path: path);
  return DioException(
    requestOptions: options,
    type: DioExceptionType.badResponse,
    response: Response(requestOptions: options, statusCode: status, data: body),
  );
}

void main() {
  group('AgentService.respondToAgent', () {
    test('POST /tasks/:id/agent-respond に {response} を送る', () async {
      final client = _RecordingClient((_) => {'success': true, 'message': 'Response sent successfully', 'executionId': 9});

      await AgentService(client).respondToAgent('801', 'develop に入れてください');

      expect(client.posts.single.path, '/tasks/801/agent-respond');
      expect(client.posts.single.data, {'response': 'develop に入れてください'});
    });

    test('409（入力待ちでない）はバックエンドの error 文面の AgentActionException', () async {
      const path = '/tasks/801/agent-respond';
      final client = _RecordingClient(
          (_) => _httpError(path, 409, {'error': 'Execution is not waiting for input: completed'}));

      await expectLater(
        AgentService(client).respondToAgent('801', '回答'),
        throwsA(isA<AgentActionException>()
            .having((e) => e.message, 'message', 'Execution is not waiting for input: completed')),
      );
    });

    test('200 でも success が無ければ失敗として扱う（成功と見せかけない）', () async {
      final client = _RecordingClient((_) => <String, dynamic>{});

      await expectLater(
        AgentService(client).respondToAgent('801', '回答'),
        throwsA(isA<AgentActionException>().having((e) => e.message, 'message', '回答を送れませんでした')),
      );
    });

    test('空白だけの回答は送らずに失敗にする', () async {
      final client = _RecordingClient((_) => {'success': true});

      await expectLater(AgentService(client).respondToAgent('801', '  \n'), throwsA(isA<AgentActionException>()));
      expect(client.posts, isEmpty);
    });
  });
}
