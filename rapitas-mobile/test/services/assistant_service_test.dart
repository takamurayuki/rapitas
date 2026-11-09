import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

/// 通信せずに決まったレスポンスを返す ApiClient（deploy_service_test.dart と同じ型）。
/// 値が DioException ならそれを投げる。受け取った受信タイムアウトを記録する。
class _FakeApiClient implements ApiClient {
  final Map<String, dynamic> responses;
  final Map<String, Duration?> timeouts = {};

  _FakeApiClient(this.responses);

  Response<T> _respond<T>(String path, Duration? receiveTimeout) {
    timeouts[path] = receiveTimeout;
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
      _respond<T>(path, receiveTimeout);

  @override
  Future<Response<T>> post<T>(String path,
          {dynamic data,
          Map<String, dynamic>? queryParameters,
          Duration? receiveTimeout}) async =>
      _respond<T>(path, receiveTimeout);

  @override
  Future<Response<T>> patch<T>(String path, {dynamic data}) async =>
      _respond<T>(path, null);

  @override
  Future<Response<T>> put<T>(String path, {dynamic data}) async =>
      _respond<T>(path, null);

  @override
  Future<Response<T>> delete<T>(String path) async => _respond<T>(path, null);

  @override
  void updateBaseUrl(String baseUrl) {}
}

DioException _dioError(String path, DioExceptionType type) =>
    DioException(requestOptions: RequestOptions(path: path), type: type);

void main() {
  group('AssistantService のタイムアウト', () {
    test('assistant 系の要求はすべて受信タイムアウト 120 秒で呼ぶ', () async {
      final client = _FakeApiClient({
        '/assistant/route': {'routed': false},
        '/assistant/ask': {'available': true, 'total': 0, 'rows': []},
        '/assistant/supervision': <String, dynamic>{},
        '/copilot/chat': {'success': true, 'content': 'こんにちは'},
      });
      final service = AssistantService(client);

      await service.routeIntent('a');
      await service.ask('a');
      await service.getSupervision();
      await service.chat('a');

      expect(client.timeouts.values,
          everyElement(const Duration(seconds: 120)));
      expect(client.timeouts, hasLength(4));
    });

    test('受信タイムアウトは AssistantTimeoutException に包む', () async {
      final client = _FakeApiClient({
        '/assistant/ask':
            _dioError('/assistant/ask', DioExceptionType.receiveTimeout),
      });

      await expectLater(
        AssistantService(client).ask('ブロックされているタスクは？'),
        throwsA(isA<AssistantTimeoutException>()),
      );
    });

    test('タイムアウト以外の通信失敗は DioException のまま投げる', () async {
      final client = _FakeApiClient({
        '/assistant/ask':
            _dioError('/assistant/ask', DioExceptionType.connectionError),
      });

      await expectLater(
        AssistantService(client).ask('a'),
        throwsA(isA<DioException>()),
      );
    });
  });

  group('RapiChatNotifier の送信失敗', () {
    Future<String> lastSystemText(Object askResult) async {
      final client = _FakeApiClient({'/assistant/ask': askResult});
      final container = ProviderContainer(overrides: [
        assistantServiceProvider.overrideWithValue(AssistantService(client)),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(rapiChatProvider.notifier)
        ..setMode(RapiMode.ask)
        ..setInput('ブロックされているタスクは？');

      await notifier.send();

      final state = container.read(rapiChatProvider);
      expect(state.sending, isFalse);
      // 失敗時は書いた文を欄に残す
      expect(state.input, 'ブロックされているタスクは？');
      return state.messages.lastWhere((m) => m.role == RapiRole.system).text;
    }

    test('タイムアウトのときはタイムアウトの案内を出す', () async {
      final text = await lastSystemText(
          _dioError('/assistant/ask', DioExceptionType.receiveTimeout));
      expect(text, rapiTimeoutMessage);
    });

    test('それ以外の失敗は従来どおり「送信に失敗しました」', () async {
      final text = await lastSystemText(
          _dioError('/assistant/ask', DioExceptionType.connectionError));
      expect(text, '送信に失敗しました');
    });
  });
}
