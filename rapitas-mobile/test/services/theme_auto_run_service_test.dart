import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/theme_auto_run_service.dart';

/// 通信せずに決まったレスポンスを返す ApiClient。POST は path と body を控える。
/// [errors] にある path は、その body を持つ 400 の DioException を投げる。
class _FakeApiClient implements ApiClient {
  final Map<String, dynamic> responses;
  final Map<String, dynamic> errors;
  final List<({String path, dynamic data})> posts = [];

  _FakeApiClient({this.responses = const {}, this.errors = const {}});

  Response<T> _respond<T>(String path) {
    if (errors.containsKey(path)) {
      final options = RequestOptions(path: path);
      throw DioException(
        requestOptions: options,
        response: Response(data: errors[path], statusCode: 400, requestOptions: options),
        type: DioExceptionType.badResponse,
      );
    }
    if (!responses.containsKey(path)) throw StateError('想定外のリクエスト: $path');
    return Response<T>(data: responses[path] as T?, statusCode: 200, requestOptions: RequestOptions(path: path));
  }

  @override
  Future<Response<T>> get<T>(String path, {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async =>
      _respond<T>(path);

  @override
  Future<Response<T>> post<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    posts.add((path: path, data: data));
    return _respond<T>(path);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// GET /themes/:id/auto-run の実際の応答形（routes/workflow/theme-auto-run.ts）
Map<String, dynamic> _runningResponse() => {
      'success': true,
      'autoRun': {
        'id': 3,
        'themeId': 5,
        'enabled': true,
        'status': 'running',
        'pauseReason': null,
        'order': 'created',
        'currentTaskId': 812,
        'processedCount': 4,
        'lastError': null,
        'lastRunAt': '2026-11-17T01:00:00.000Z',
        'startedAt': '2026-11-17T00:30:00.000Z',
        'idleSince': null,
        'idleStoppedAt': null,
        'lastSelfRefillAt': null,
        'updatedAt': '2026-11-17T01:00:00.000Z',
      },
      'currentTask': {'id': 812, 'title': 'ログイン画面を作る', 'status': 'in-progress', 'workflowStatus': 'in_progress'},
      'remainingCount': 7,
    };

void main() {
  group('ThemeAutoRunService.getAutoRun', () {
    test('GET の応答から状態・現在のタスク・残り件数を読む', () async {
      final client = _FakeApiClient(responses: {'/themes/5/auto-run': _runningResponse()});
      final snapshot = await ThemeAutoRunService(client).getAutoRun('5');

      expect(snapshot.state.themeId, '5');
      expect(snapshot.state.status, 'running');
      expect(snapshot.state.isRunning, isTrue);
      expect(snapshot.state.order, 'created');
      expect(snapshot.state.currentTaskId, '812');
      expect(snapshot.state.processedCount, 4);
      expect(snapshot.state.lastError, isNull);
      expect(snapshot.currentTaskTitle, 'ログイン画面を作る');
      expect(snapshot.remainingCount, 7);
    });

    test('一度も動かしていないテーマ（idle・currentTask なし）も読める', () async {
      final client = _FakeApiClient(responses: {
        '/themes/9/auto-run': {
          'success': true,
          'autoRun': {
            'themeId': 9,
            'enabled': false,
            'status': 'idle',
            'pauseReason': null,
            'order': 'priority',
            'currentTaskId': null,
            'processedCount': 0,
            'lastError': '作業フォルダが見つかりません',
          },
          'currentTask': null,
          'remainingCount': 0,
        },
      });
      final snapshot = await ThemeAutoRunService(client).getAutoRun('9');

      expect(snapshot.state.status, 'idle');
      expect(snapshot.state.currentTaskId, isNull);
      expect(snapshot.currentTaskTitle, isNull);
      expect(snapshot.state.lastError, '作業フォルダが見つかりません');
    });

    test('success が true でない応答は error の文面で失敗にする', () async {
      final client = _FakeApiClient(responses: {
        '/themes/5/auto-run': {'success': false, 'error': 'Failed to retrieve auto-run state'},
      });
      expect(
        () => ThemeAutoRunService(client).getAutoRun('5'),
        throwsA(isA<ThemeAutoRunException>()
            .having((e) => e.toString(), 'message', 'Failed to retrieve auto-run state')),
      );
    });
  });

  group('ThemeAutoRunService.control', () {
    test('開始は /themes/:id/auto-run へ action と order を POST する', () async {
      final client = _FakeApiClient(responses: {'/themes/5/auto-run': _runningResponse()});
      await ThemeAutoRunService(client).start('5', order: 'created');

      expect(client.posts.single.path, '/themes/5/auto-run');
      expect(client.posts.single.data, {'action': 'start', 'order': 'created'});
    });

    test('停止・一時停止は action だけを POST する', () async {
      final client = _FakeApiClient(responses: {'/themes/5/auto-run': {'success': true, 'autoRun': {}}});
      final service = ThemeAutoRunService(client);
      await service.stop('5');
      await service.pause('5');

      expect(client.posts.map((p) => p.data).toList(), [
        {'action': 'stop'},
        {'action': 'pause'},
      ]);
    });

    test('400 の理由（error）をそのまま例外の文面にする', () async {
      const reason = '自動実行は開発モードで作業ディレクトリが設定されたテーマのみ利用できます。';
      final client = _FakeApiClient(errors: {
        '/themes/7/auto-run': {'success': false, 'error': reason},
      });
      expect(
        () => ThemeAutoRunService(client).start('7'),
        throwsA(isA<ThemeAutoRunException>().having((e) => e.toString(), 'message', reason)),
      );
    });
  });
}
