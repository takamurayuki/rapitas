import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/deploy_service.dart';

/// 通信せずに決まったレスポンスを返す ApiClient（agent_service_test.dart と同じ型）。
/// 値が DioException ならそれを投げる（409 の再現用）。
class _FakeApiClient implements ApiClient {
  final Map<String, dynamic> responses;
  final List<String> postCalls = [];

  _FakeApiClient(this.responses);

  Response<T> _respond<T>(String path) {
    if (!responses.containsKey(path)) {
      throw StateError('想定外のリクエスト: $path');
    }
    final value = responses[path];
    if (value is DioException) throw value;
    return Response<T>(
      data: value as T?,
      statusCode: 200,
      requestOptions: RequestOptions(path: path),
    );
  }

  @override
  Future<Response<T>> get<T>(String path,
          {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async =>
      _respond<T>(path);

  @override
  Future<Response<T>> post<T>(String path,
      {dynamic data,
          Map<String, dynamic>? queryParameters,
          Duration? receiveTimeout}) async {
    postCalls.add(path);
    return _respond<T>(path);
  }

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

DioException _conflict(String reason) {
  final options = RequestOptions(path: '/deploy/now', method: 'POST');
  return DioException(
    requestOptions: options,
    type: DioExceptionType.badResponse,
    response: Response<dynamic>(
      requestOptions: options,
      statusCode: 409,
      data: {'deployed': false, 'reason': reason},
    ),
  );
}

void main() {
  group('DeployService.getStatus', () {
    test('ready / reason / aheadCount を読む', () async {
      final client = _FakeApiClient({
        '/deploy/status': {'ready': true, 'reason': 'deployed', 'aheadCount': 3},
      });

      final status = await DeployService(client).getStatus();

      expect(status.ready, isTrue);
      expect(status.reason, 'deployed');
      expect(status.aheadCount, 3);
    });

    test('aheadCount が無ければ null', () async {
      final client = _FakeApiClient({
        '/deploy/status': {'ready': false, 'reason': 'no-startup-commit'},
      });

      final status = await DeployService(client).getStatus();

      expect(status.ready, isFalse);
      expect(status.reason, 'no-startup-commit');
      expect(status.aheadCount, isNull);
    });
  });

  group('DeployService.deployNow', () {
    test('200 の {deployed: true} を読む', () async {
      final client = _FakeApiClient({
        '/deploy/now': {'deployed': true, 'reason': 'deployed', 'aheadCount': 2},
      });

      final result = await DeployService(client).deployNow();

      expect(client.postCalls, ['/deploy/now']);
      expect(result.deployed, isTrue);
      expect(result.reason, 'deployed');
      expect(result.aheadCount, 2);
    });

    test('409 は本文の reason を持つ DeployException になる', () async {
      final client = _FakeApiClient({'/deploy/now': _conflict('active-executions')});

      await expectLater(
        DeployService(client).deployNow(),
        throwsA(isA<DeployException>()
            .having((e) => e.reason, 'reason', 'active-executions')),
      );
    });

    test('レスポンスの無い通信失敗は reason が network', () async {
      final client = _FakeApiClient({
        '/deploy/now': DioException(
          requestOptions: RequestOptions(path: '/deploy/now'),
          type: DioExceptionType.connectionError,
        ),
      });

      await expectLater(
        DeployService(client).deployNow(),
        throwsA(isA<DeployException>().having((e) => e.reason, 'reason', 'network')),
      );
    });
  });

  group('deployReasonMessage', () {
    test('代表的な理由コード', () {
      expect(deployReasonMessage('nothing-to-activate'), 'すでに最新の状態です。再起動は不要でした');
      expect(deployReasonMessage('running-executions'), '実行中のタスクがあるため、今は再起動できません');
      expect(deployReasonMessage('working-tree-dirty'), 'デスクトップ側に未保存の変更があるため、再起動できません');
    });

    test('知らない理由コードはそのまま括弧で添える', () {
      expect(deployReasonMessage('something-new'), '再起動できませんでした（something-new）');
    });
  });
}
