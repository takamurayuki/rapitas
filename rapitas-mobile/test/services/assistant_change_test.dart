import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// ラピの「変更（change）」：update-draft / task-update / task-update/revert の
// リクエストの形と、チャットでの 提案 → 適用 → 取り消し（409 を含む）の流れ。
// 形はバックエンド rapitas-backend/routes/ai/assistant-update.routes.ts が正。

/// 送ったボディを記録し、パスごとに決まった応答を返す ApiClient。
/// 応答が [_Status] なら、その状態コードの badResponse（Dio の既定の validateStatus と同じ）を投げる。
class _RecordingApiClient implements ApiClient {
  final Map<String, List<Object>> responses;
  final List<(String, dynamic)> sent = [];

  _RecordingApiClient(this.responses);

  Response<T> _respond<T>(String path, dynamic data) {
    sent.add((path, data));
    final queue = responses[path];
    if (queue == null || queue.isEmpty) throw StateError('想定外のリクエスト: $path');
    final value = queue.length > 1 ? queue.removeAt(0) : queue.first;
    final options = RequestOptions(path: path);
    if (value is _Status) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(
            data: value.body, statusCode: value.code, requestOptions: options),
      );
    }
    if (value is DioException) throw value;
    return Response<T>(data: value as T?, statusCode: 200, requestOptions: options);
  }

  @override
  Future<Response<T>> get<T>(String path,
          {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async =>
      _respond<T>(path, null);

  @override
  Future<Response<T>> post<T>(String path,
          {dynamic data,
          Map<String, dynamic>? queryParameters,
          Duration? receiveTimeout}) async =>
      _respond<T>(path, data);

  @override
  Future<Response<T>> patch<T>(String path, {dynamic data}) async => _respond<T>(path, data);

  @override
  Future<Response<T>> put<T>(String path, {dynamic data}) async => _respond<T>(path, data);

  @override
  Future<Response<T>> delete<T>(String path) async => _respond<T>(path, null);

  @override
  void updateBaseUrl(String baseUrl) {}

  dynamic bodyOf(String path) => sent.lastWhere((s) => s.$1 == path).$2;
}

class _Status {
  final int code;
  final Map<String, dynamic> body;
  const _Status(this.code, this.body);
}

const _proposalBody = {
  'success': true,
  'considered': 42,
  'proposal': {
    'kind': 'proposal',
    'taskId': 7,
    'title': 'ログインのバグを直す',
    'changes': {'status': 'done', 'dueDate': null},
    'reason': '「完了にして」と言っているため',
  },
};

const _appliedBody = {
  'success': true,
  'actionId': 31,
  'before': {'status': 'in-progress', 'dueDate': '2026-11-20'},
  'after': {'status': 'done', 'dueDate': null},
};

void main() {
  group('AssistantService のリクエストの形', () {
    test('updateDraft は POST /assistant/update-draft {text} で、提案を読む', () async {
      final client = _RecordingApiClient({
        '/assistant/update-draft': [_proposalBody],
      });

      final draft = await AssistantService(client).updateDraft('ログインのバグを完了にして');

      expect(client.bodyOf('/assistant/update-draft'), {'text': 'ログインのバグを完了にして'});
      expect(draft.considered, 42);
      final p = draft.proposal!;
      expect(p.taskId, '7');
      expect(p.title, 'ログインのバグを直す');
      expect(p.changes.fields, ['status', 'dueDate']);
      // dueDate: null は「期限を外す」。キーは残す
      expect(p.changes.values.containsKey('dueDate'), isTrue);
      expect(p.changes.values['dueDate'], isNull);
      expect(p.reason, contains('完了'));
    });

    test('updateDraft の unclear は提案なしで理由を返す', () async {
      final client = _RecordingApiClient({
        '/assistant/update-draft': [
          {
            'success': true,
            'considered': 60,
            'proposal': {
              'kind': 'unclear',
              'unclear': ['どのタスクのことか特定できませんでした。'],
            },
          }
        ],
      });

      final draft = await AssistantService(client).updateDraft('あれを終わらせて');

      expect(draft.proposal, isNull);
      expect(draft.unclear, ['どのタスクのことか特定できませんでした。']);
      expect(draft.considered, 60);
    });

    test('taskUpdate は {taskId: 数値, changes, confirmed: true} を送り、before/after を読む', () async {
      final client = _RecordingApiClient({
        '/assistant/task-update': [_appliedBody],
      });

      final result = await AssistantService(client).taskUpdate(
        '7',
        const TaskChanges({'status': 'done', 'dueDate': null}),
      );

      expect(client.bodyOf('/assistant/task-update'), {
        'taskId': 7,
        'changes': {'status': 'done', 'dueDate': null},
        'confirmed': true,
      });
      expect(result.actionId, 31);
      expect(result.before, {'status': 'in-progress', 'dueDate': '2026-11-20'});
      expect(result.after, {'status': 'done', 'dueDate': null});
    });

    test('taskUpdate の失敗応答は error と状態コード付きの AssistantException', () async {
      final client = _RecordingApiClient({
        '/assistant/task-update': [
          const _Status(409, {'success': false, 'error': 'no_change'})
        ],
      });

      await expectLater(
        AssistantService(client).taskUpdate('7', const TaskChanges({'status': 'done'})),
        throwsA(isA<AssistantException>()
            .having((e) => e.code, 'code', 'no_change')
            .having((e) => e.statusCode, 'statusCode', 409)),
      );
    });

    test('revertTaskUpdate は POST /assistant/task-update/revert {actionId}', () async {
      final client = _RecordingApiClient({
        '/assistant/task-update/revert': [
          {'success': true}
        ],
      });

      final r = await AssistantService(client).revertTaskUpdate(31);

      expect(client.bodyOf('/assistant/task-update/revert'), {'actionId': 31});
      expect(r.reverted, isTrue);
    });

    test('revert の 409 は例外にせず、競合した項目を返す', () async {
      final client = _RecordingApiClient({
        '/assistant/task-update/revert': [
          const _Status(409, {
            'success': false,
            'error': 'changed_since',
            'conflicts': ['priority'],
          })
        ],
      });

      final r = await AssistantService(client).revertTaskUpdate(31);

      expect(r.reverted, isFalse);
      expect(r.conflicts, ['priority']);
    });

    test('revert の 404 は AssistantException のまま投げる', () async {
      final client = _RecordingApiClient({
        '/assistant/task-update/revert': [
          const _Status(404, {'success': false, 'error': 'no_undoable_update'})
        ],
      });

      await expectLater(
        AssistantService(client).revertTaskUpdate(31),
        throwsA(isA<AssistantException>().having((e) => e.statusCode, 'statusCode', 404)),
      );
    });
  });

  group('RapiChatNotifier の変更（change）', () {
    late _RecordingApiClient client;
    late ProviderContainer container;

    void setUpWith(Map<String, List<Object>> extra) {
      client = _RecordingApiClient({
        '/assistant/route': [
          {'routed': true, 'intent': 'change', 'reason': '既存タスクの変更'}
        ],
        '/assistant/update-draft': [_proposalBody],
        // 一覧・詳細の再読み込み（invalidate）で呼ばれても落ちないように
        '/tasks': [<dynamic>[]],
        ...extra,
      });
      // 適用・取り消しのあとの一覧・詳細の invalidate が本物の接続設定を読みに行かないよう、
      // ApiClient ごと差し替える（AssistantService もこれを使う）
      container = ProviderContainer(overrides: [
        apiClientProvider.overrideWithValue(client),
      ]);
      addTearDown(container.dispose);
    }

    RapiChatNotifier notifier() => container.read(rapiChatProvider.notifier);
    RapiMessage cardMessage() =>
        container.read(rapiChatProvider).messages.lastWhere((m) => m.change != null);

    Future<void> sendChange() async {
      notifier().setInput('ログインのバグを完了にして');
      await notifier().send();
    }

    test('change に振り分けたら提案カードを出し、デスクトップ版の案内は出さない', () async {
      setUpWith({});

      await sendChange();

      final messages = container.read(rapiChatProvider).messages;
      expect(messages.any((m) => m.text.contains('デスクトップ版')), isFalse);
      expect(messages.any((m) => m.text == 'タスクの変更として受け取りました — 既存タスクの変更'), isTrue);
      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.proposed);
      expect(card.proposal.title, 'ログインのバグを直す');
      expect(card.considered, 42);
      // 提案の段階では何も書き込まない
      expect(client.sent.map((s) => s.$1), isNot(contains('/assistant/task-update')));
    });

    test('適用 → 取り消し：task-update を confirmed で送り、actionId で revert する', () async {
      setUpWith({
        '/assistant/task-update': [_appliedBody],
        '/assistant/task-update/revert': [
          {'success': true}
        ],
      });
      await sendChange();
      final id = cardMessage().id;

      await notifier().applyChange(id);

      var card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.applied);
      expect(card.result!.actionId, 31);
      expect(card.canRevert, isTrue);
      expect(client.bodyOf('/assistant/task-update'),
          {'taskId': 7, 'changes': {'status': 'done', 'dueDate': null}, 'confirmed': true});

      await notifier().revertChange(id);

      card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.reverted);
      expect(card.canRevert, isFalse);
      expect(client.bodyOf('/assistant/task-update/revert'), {'actionId': 31});
    });

    test('取り消しが 409 なら競合した項目を持ち、取り消しボタンは下げる', () async {
      setUpWith({
        '/assistant/task-update': [_appliedBody],
        '/assistant/task-update/revert': [
          const _Status(409, {
            'success': false,
            'error': 'changed_since',
            'conflicts': ['status'],
          })
        ],
      });
      await sendChange();
      final id = cardMessage().id;
      await notifier().applyChange(id);

      await notifier().revertChange(id);

      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.applied);
      expect(card.conflicts, ['status']);
      expect(card.canRevert, isFalse);
    });

    test('適用の失敗はカード内に案内し、もう一度押せる状態に戻す', () async {
      setUpWith({
        '/assistant/task-update': [
          const _Status(404, {'success': false, 'error': 'not_found'})
        ],
      });
      await sendChange();
      final id = cardMessage().id;

      await notifier().applyChange(id);

      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.proposed);
      expect(card.error, contains('見つかりませんでした'));
    });

    DioException dioError(String path, DioExceptionType type) =>
        DioException(requestOptions: RequestOptions(path: path), type: type);

    test('適用がタイムアウトしたら結果不明にし、再適用させない', () async {
      setUpWith({
        '/assistant/task-update': [
          dioError('/assistant/task-update', DioExceptionType.receiveTimeout),
        ],
      });
      await sendChange();
      final id = cardMessage().id;

      await notifier().applyChange(id);

      var card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.applyUnknown);
      expect(card.canRevert, isFalse);
      expect(card.result, isNull);
      final updates = client.sent.where((s) => s.$1 == '/assistant/task-update').length;
      expect(updates, 1);

      // 押されても（古いボタンが残っていても）task-update を送り直さない
      await notifier().applyChange(id);
      notifier().cancelChange(id);
      card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.applyUnknown);
      expect(client.sent.where((s) => s.$1 == '/assistant/task-update').length, updates);
    });

    test('適用が 5xx や通信の途中切れでも結果不明にする', () async {
      for (final failure in <Object>[
        const _Status(500, {'success': false, 'error': 'internal'}),
        dioError('/assistant/task-update', DioExceptionType.unknown),
      ]) {
        setUpWith({'/assistant/task-update': [failure]});
        await sendChange();
        await notifier().applyChange(cardMessage().id);
        expect(cardMessage().change!.phase, RapiChangePhase.applyUnknown, reason: '$failure');
      }
    });

    test('適用の応答の形が読めなければ（unexpected_response）結果不明にし、再適用させない', () async {
      for (final malformed in <Object>[
        '<html>502 Bad Gateway</html>',
        <String, dynamic>{'actionId': 1},
      ]) {
        setUpWith({
          '/assistant/task-update': [malformed],
        });
        await sendChange();
        final id = cardMessage().id;

        await notifier().applyChange(id);

        var card = cardMessage().change!;
        expect(card.phase, RapiChangePhase.applyUnknown, reason: '$malformed');
        expect(card.canRevert, isFalse);
        expect(card.result, isNull);
        expect(client.sent.where((s) => s.$1 == '/assistant/task-update').length, 1);

        // 押されても task-update を送り直さない
        await notifier().applyChange(id);
        notifier().cancelChange(id);
        card = cardMessage().change!;
        expect(card.phase, RapiChangePhase.applyUnknown);
        expect(client.sent.where((s) => s.$1 == '/assistant/task-update').length, 1);
      }
    });

    test('2xx で明示的に success:false なら未適用と言い切れるので、押し直せる状態に戻す', () async {
      setUpWith({
        '/assistant/task-update': [
          <String, dynamic>{'success': false, 'error': 'no_change'},
        ],
      });
      await sendChange();

      await notifier().applyChange(cardMessage().id);

      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.proposed);
      expect(card.error, contains('変更はありませんでした'));
    });

    test('適用の応答が 3xx なら（リダイレクト先で処理されたかもしれない）結果不明にし、再適用させない',
        () async {
      for (final code in [301, 302, 304, 307]) {
        setUpWith({
          '/assistant/task-update': [
            _Status(code, const {'success': false, 'error': 'moved'}),
          ],
        });
        await sendChange();
        final id = cardMessage().id;

        await notifier().applyChange(id);

        var card = cardMessage().change!;
        expect(card.phase, RapiChangePhase.applyUnknown, reason: '$code');
        expect(card.canRevert, isFalse);
        expect(client.sent.where((s) => s.$1 == '/assistant/task-update').length, 1);

        // 押されても task-update を送り直さない
        await notifier().applyChange(id);
        card = cardMessage().change!;
        expect(card.phase, RapiChangePhase.applyUnknown, reason: '$code');
        expect(client.sent.where((s) => s.$1 == '/assistant/task-update').length, 1);
      }
    });

    test('4xx の境界：400 と 499 は未適用（押し直せる）、399 と 500 は結果不明', () async {
      for (final (code, phase) in [
        (400, RapiChangePhase.proposed),
        (499, RapiChangePhase.proposed),
        (399, RapiChangePhase.applyUnknown),
        (500, RapiChangePhase.applyUnknown),
      ]) {
        setUpWith({
          '/assistant/task-update': [
            _Status(code, const {'success': false, 'error': 'x'}),
          ],
        });
        await sendChange();
        await notifier().applyChange(cardMessage().id);
        expect(cardMessage().change!.phase, phase, reason: '$code');
      }
    });

    test('接続できなかった適用は未適用と言い切れるので、押し直せる状態に戻す', () async {
      setUpWith({
        '/assistant/task-update': [
          dioError('/assistant/task-update', DioExceptionType.connectionError),
        ],
      });
      await sendChange();

      await notifier().applyChange(cardMessage().id);

      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.proposed);
      expect(card.error, isNotNull);
    });

    test('取り消しが no_undoable_update の 404 なら取り消しを終え、ボタンを下げる', () async {
      setUpWith({
        '/assistant/task-update': [_appliedBody],
        '/assistant/task-update/revert': [
          const _Status(404, {'success': false, 'error': 'no_undoable_update'})
        ],
      });
      await sendChange();
      final id = cardMessage().id;
      await notifier().applyChange(id);

      await notifier().revertChange(id);

      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.revertUnavailable);
      expect(card.canRevert, isFalse);
      expect(card.error, isNull);
      // もう押せない（送り直さない）
      await notifier().revertChange(id);
      expect(client.sent.where((s) => s.$1 == '/assistant/task-update/revert').length, 1);
    });

    test('取り消しがタスク不存在の 404 なら従来どおりの案内', () async {
      setUpWith({
        '/assistant/task-update': [_appliedBody],
        '/assistant/task-update/revert': [
          const _Status(404, {'success': false, 'error': 'not_found', 'conflicts': []})
        ],
      });
      await sendChange();
      final id = cardMessage().id;
      await notifier().applyChange(id);

      await notifier().revertChange(id);

      final card = cardMessage().change!;
      expect(card.phase, RapiChangePhase.applied);
      expect(card.error, '元に戻せませんでした。タスクが見つかりません。');
    });

    test('「やめる」でカードを下げ、何も書き込まない', () async {
      setUpWith({});
      await sendChange();

      notifier().cancelChange(cardMessage().id);

      final messages = container.read(rapiChatProvider).messages;
      expect(messages.where((m) => m.change != null), isEmpty);
      expect(client.sent.map((s) => s.$1), isNot(contains('/assistant/task-update')));
    });

    test('unclear はその理由をラピの返信として出し、言い直しを促す', () async {
      setUpWith({
        '/assistant/update-draft': [
          {
            'success': true,
            'considered': 60,
            'proposal': {
              'kind': 'unclear',
              'unclear': ['どのタスクのことか特定できませんでした。'],
            },
          }
        ],
      });

      await sendChange();

      final state = container.read(rapiChatProvider);
      final last = state.messages.last;
      expect(last.role, RapiRole.assistant);
      expect(last.change, isNull);
      expect(last.text, contains('どのタスクのことか特定できませんでした。'));
      expect(last.text, contains('最近更新された60件'));
      expect(last.text, contains('もう一度送ってください'));
      // 送信自体は成功扱い（欄は空のまま。言い直して送れば最初から下書きし直す）
      expect(state.input, isEmpty);
    });
  });
}
