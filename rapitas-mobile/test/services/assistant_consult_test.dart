import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// ラピの「相談（consult）」：copilot/chat（taskId つき）と copilot/chat/:taskId/history の
// リクエストの形と、チャットでの 振り分け → タスク選び → 相談モード → 抜ける の流れ。
// 形はバックエンド rapitas-backend/routes/ai/copilot-chat.ts と
// services/ai/copilot-chat-service.ts が正。

/// 送ったボディを記録し、パスごとに決まった応答を返す ApiClient。
/// 応答が [_Status] なら、その状態コードの badResponse を投げる。
/// [gates] にパスがあれば、その Completer が完了するまで GET の応答を止める（送ったことは先に記録する）。
class _RecordingApiClient implements ApiClient {
  final Map<String, List<Object>> responses;
  final List<(String, dynamic)> sent = [];
  final Map<String, Completer<void>> gates = {};

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
      {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    final gate = gates[path];
    if (gate != null) {
      sent.add((path, null));
      await gate.future;
      sent.removeLast();
    }
    return _respond<T>(path, null);
  }

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

  List<dynamic> bodiesOf(String path) =>
      [for (final s in sent) if (s.$1 == path) s.$2];

  List<String> get paths => [for (final s in sent) s.$1];
}

class _Status {
  final int code;
  final Map<String, dynamic> body;
  const _Status(this.code, this.body);
}

Map<String, dynamic> _reply(String content) =>
    {'success': true, 'content': content, 'model': 'claude-haiku', 'tier': 'economy', 'cached': false};

const _consultRoute = {'routed': true, 'intent': 'consult', 'reason': 'タスクについて聞いている'};
const _chatRoute = {'routed': false};

/// 過去の相談 12件（u0, a0, u1, a1, ...）
List<Map<String, dynamic>> _pastMessages(int n) => [
      for (var i = 0; i < n; i++)
        {
          'id': 100 + i,
          'taskId': 7,
          'role': i.isEven ? 'user' : 'assistant',
          'content': i.isEven ? 'u${i ~/ 2}' : 'a${i ~/ 2}',
          'createdAt': '2026-11-0${1 + i % 8}T10:00:00.000Z',
        }
    ];

const _task = RapiConsultTask(id: '7', title: 'ログインのバグを直す');

void main() {
  group('AssistantService のリクエストの形', () {
    test('copilotChat は {message, taskId: 数値, conversationHistory} を送り、返信を読む', () async {
      final client = _RecordingApiClient({
        '/copilot/chat': [_reply('まずは再現手順を固めましょう')],
      });
      final history = [
        {'role': 'user', 'content': '前の質問'},
        {'role': 'assistant', 'content': '前の答え'},
      ];

      final reply = await AssistantService(client)
          .copilotChat('どこから手を付ける？', taskId: '7', history: history);

      expect(client.bodiesOf('/copilot/chat').single, {
        'message': 'どこから手を付ける？',
        'taskId': 7,
        'conversationHistory': history,
      });
      expect(reply.content, 'まずは再現手順を固めましょう');
      expect(reply.tier, 'economy');
    });

    test('copilotChat の {error}（success なし）や 5xx は AssistantException', () async {
      final ok200 = _RecordingApiClient({
        '/copilot/chat': [
          {'error': 'リクエストが多すぎます。'}
        ],
      });
      await expectLater(
        AssistantService(ok200).copilotChat('質問', taskId: '7'),
        throwsA(isA<AssistantException>().having((e) => e.code, 'code', 'リクエストが多すぎます。')),
      );

      final failed = _RecordingApiClient({
        '/copilot/chat': [
          const _Status(500, {'error': 'Copilot chat failed'})
        ],
      });
      await expectLater(
        AssistantService(failed).copilotChat('質問', taskId: '7'),
        throwsA(isA<AssistantException>()
            .having((e) => e.code, 'code', 'Copilot chat failed')
            .having((e) => e.statusCode, 'statusCode', 500)),
      );
    });

    test('copilotChat は数値でない taskId を送らずに弾く', () async {
      final client = _RecordingApiClient({});
      await expectLater(
        AssistantService(client).copilotChat('質問', taskId: 'abc'),
        throwsA(isA<AssistantException>().having((e) => e.code, 'code', 'invalid_task')),
      );
      expect(client.sent, isEmpty);
    });

    test('copilotHistory は GET /copilot/chat/:taskId/history の messages を古い順に読む', () async {
      final client = _RecordingApiClient({
        '/copilot/chat/7/history': [
          {
            'messages': [
              {'id': 1, 'taskId': 7, 'role': 'user', 'content': '質問', 'createdAt': '2026-11-01T10:00:00.000Z'},
              {'id': 2, 'taskId': 7, 'role': 'assistant', 'content': '答え', 'createdAt': '2026-11-01T10:00:05.000Z'},
              {'id': 3, 'taskId': 7, 'role': 'assistant', 'content': ''},
            ]
          }
        ],
      });

      final past = await AssistantService(client).copilotHistory('7');

      expect(client.paths, ['/copilot/chat/7/history']);
      expect(past.map((m) => m.content), ['質問', '答え']);
      expect(past.map((m) => m.fromUser), [true, false]);
      expect(past.first.id, '1');
      expect(past.first.createdAt, DateTime.utc(2026, 11, 1, 10));
    });

    test('copilotHistory は messages が無ければ空', () async {
      final client = _RecordingApiClient({
        '/copilot/chat/7/history': [<String, dynamic>{}],
      });
      expect(await AssistantService(client).copilotHistory('7'), isEmpty);
    });
  });

  group('チャットでの相談の流れ', () {
    late _RecordingApiClient client;
    late ProviderContainer container;

    RapiChatNotifier chat() => container.read(rapiChatProvider.notifier);
    RapiChatState state() => container.read(rapiChatProvider);

    Future<void> say(String text) async {
      chat().setInput(text);
      await chat().send();
    }

    int pickerId() => state().messages.lastWhere((m) => m.consultPicker != null).id;

    void setUpWith(Map<String, List<Object>> responses) {
      client = _RecordingApiClient(responses);
      container = ProviderContainer(overrides: [
        assistantServiceProvider.overrideWithValue(AssistantService(client)),
      ]);
      addTearDown(container.dispose);
    }

    test('振り分けが consult ならタスク選びカードを出し、発言はまだ送らない', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
      });

      await say('このバグ、どこから調べればいい？');

      expect(client.bodiesOf('/assistant/route').single,
          {'text': 'このバグ、どこから調べればいい？', 'hasOpenTask': false});
      expect(client.paths, isNot(contains('/copilot/chat')));
      final picker = state().messages.last.consultPicker!;
      expect(picker.phase, RapiConsultPickPhase.choosing);
      expect(picker.text, 'このバグ、どこから調べればいい？');
      // デスクトップ版の案内は出さない
      expect(state().messages.where((m) => m.text.contains('デスクトップ版')), isEmpty);
      expect(state().consultTask, isNull);
      expect(state().sending, isFalse);
    });

    test('タスクを選ぶと相談モードに入り、履歴を読んでから保留した発言を送る（履歴は直近10件・今回分なし）',
        () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          {'messages': _pastMessages(12)}
        ],
        '/copilot/chat': [_reply('まずはログを見ましょう')],
      });
      await say('このバグ、どこから調べればいい？');

      await chat().chooseConsultTask(pickerId(), _task);

      expect(state().consultTask?.id, '7');
      expect(client.paths, [
        '/assistant/route',
        '/copilot/chat/7/history',
        '/copilot/chat',
      ]);
      final body = client.bodiesOf('/copilot/chat').single as Map;
      expect(body['message'], 'このバグ、どこから調べればいい？');
      expect(body['taskId'], 7);
      final history = (body['conversationHistory'] as List).cast<Map>();
      expect(history, hasLength(10));
      // 古い2件（u0, a0）が落ち、u1..a5 の10件。今回の発言は含まない
      expect(history.first, {'role': 'user', 'content': 'u1'});
      expect(history.last, {'role': 'assistant', 'content': 'a5'});
      expect(history.map((h) => h['content']), isNot(contains('このバグ、どこから調べればいい？')));

      // 表示：選んだ控え → 履歴の見出し → 過去の12件 → 今回の発言 → 返信
      final shown = state().messages;
      final pickerAt = shown.indexWhere((m) => m.consultPicker != null);
      expect(shown[pickerAt].consultPicker!.phase, RapiConsultPickPhase.chosen);
      final rest = shown.sublist(pickerAt + 1);
      expect(rest.first.text, '「ログインのバグを直す」のこれまでの相談（12件）');
      expect(rest.skip(1).take(12).map((m) => m.text).toList(),
          [for (final m in _pastMessages(12)) m['content']]);
      expect(rest[13].role, RapiRole.user);
      expect(rest[13].text, 'このバグ、どこから調べればいい？');
      expect(rest.last.text, 'まずはログを見ましょう');
      expect(rest.skip(1).every((m) => m.consultTaskId == '7'), isTrue);
      // 保留した発言は選ぶ前の位置からは消え、スレッドの末尾に1回だけ並ぶ
      expect(shown.where((m) => m.text == 'このバグ、どこから調べればいい？'), hasLength(1));
    });

    test('相談モード中の発言は振り分けを通さず、taskId つきで送る（一般チャットへ行かない）', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          {'messages': <Object>[]}
        ],
        '/copilot/chat': [_reply('ログを見ましょう'), _reply('再現手順を書きましょう')],
      });
      await say('このバグ、どこから調べればいい？');
      await chat().chooseConsultTask(pickerId(), _task);

      await say('ログには何も出ていない');

      expect(client.bodiesOf('/assistant/route'), hasLength(1));
      final bodies = client.bodiesOf('/copilot/chat').cast<Map>();
      expect(bodies, hasLength(2));
      expect(bodies.every((b) => b['taskId'] == 7), isTrue);
      expect(bodies.last['message'], 'ログには何も出ていない');
      expect(bodies.last['conversationHistory'], [
        {'role': 'user', 'content': 'このバグ、どこから調べればいい？'},
        {'role': 'assistant', 'content': 'ログを見ましょう'},
      ]);
      expect(state().messages.last.text, '再現手順を書きましょう');
      expect(state().messages.last.consultTaskId, '7');
    });

    test('抜けると通常の振り分けに戻り、一般の会話（taskId null）に相談スレッドを混ぜない', () async {
      setUpWith({
        '/assistant/route': [_consultRoute, _chatRoute],
        '/copilot/chat/7/history': [
          {'messages': <Object>[]}
        ],
        '/copilot/chat': [_reply('ログを見ましょう'), _reply('こんにちは')],
      });
      await say('このバグ、どこから調べればいい？');
      await chat().chooseConsultTask(pickerId(), _task);

      chat().exitConsult();
      expect(state().consultTask, isNull);
      expect(state().messages.last.text, '「ログインのバグを直す」の相談を終えました');

      await say('こんにちは');

      expect(client.bodiesOf('/assistant/route').last, {'text': 'こんにちは', 'hasOpenTask': false});
      final general = client.bodiesOf('/copilot/chat').last as Map;
      expect(general['taskId'], isNull);
      expect(general['message'], 'こんにちは');
      // 挨拶は履歴に入らず、相談スレッドの発言も入らない
      expect(general['conversationHistory'], isEmpty);
    });

    test('最初の相談が送れなかったら、発言を欄に戻す（相談モードには入ったまま）', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          {'messages': <Object>[]}
        ],
        '/copilot/chat': [
          const _Status(500, {'error': 'Copilot chat failed'})
        ],
      });
      await say('このバグ、どこから調べればいい？');

      await chat().chooseConsultTask(pickerId(), _task);

      expect(state().input, 'このバグ、どこから調べればいい？');
      expect(state().consultTask?.id, '7');
      expect(state().messages.last.text, '送信に失敗しました');
      final utterance =
          state().messages.lastWhere((m) => m.text == 'このバグ、どこから調べればいい？');
      expect(utterance.inHistory, isFalse);
      expect(state().sending, isFalse);
    });

    test('履歴が読めなくても、そのことを伝えて相談は送る', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          const _Status(500, {'error': 'db'})
        ],
        '/copilot/chat': [_reply('ログを見ましょう')],
      });
      await say('このバグ、どこから調べればいい？');

      await chat().chooseConsultTask(pickerId(), _task);

      expect(state().messages.map((m) => m.text),
          contains('「ログインのバグを直す」のこれまでの相談を読み込めませんでした'));
      expect((client.bodiesOf('/copilot/chat').single as Map)['conversationHistory'], isEmpty);
      expect(state().messages.last.text, 'ログを見ましょう');
    });

    test('同じタスクに入り直したら、この会話のスレッドを使い、履歴を読み直さない', () async {
      setUpWith({
        '/assistant/route': [_consultRoute, _consultRoute],
        '/copilot/chat/7/history': [
          {'messages': _pastMessages(2)}
        ],
        '/copilot/chat': [_reply('ログを見ましょう'), _reply('続きです')],
      });
      await say('このバグ、どこから調べればいい？');
      await chat().chooseConsultTask(pickerId(), _task);
      chat().exitConsult();

      await say('さっきの続きを相談したい');
      await chat().chooseConsultTask(pickerId(), _task);

      expect(client.bodiesOf('/copilot/chat/7/history'), hasLength(1));
      final last = client.bodiesOf('/copilot/chat').last as Map;
      expect(last['conversationHistory'], [
        {'role': 'user', 'content': 'u0'},
        {'role': 'assistant', 'content': 'a0'},
        {'role': 'user', 'content': 'このバグ、どこから調べればいい？'},
        {'role': 'assistant', 'content': 'ログを見ましょう'},
      ]);
    });

    test('「やめる」と次の発言でカードは閉じ、閉じたカードからは送れない', () async {
      setUpWith({
        '/assistant/route': [_consultRoute, _chatRoute],
        '/copilot/chat': [_reply('こんにちは')],
      });
      await say('このバグ、どこから調べればいい？');
      final first = pickerId();

      await say('やっぱりいいや');
      expect(state().messages.firstWhere((m) => m.id == first).consultPicker!.phase,
          RapiConsultPickPhase.closed);
      await chat().chooseConsultTask(first, _task);
      expect(state().consultTask, isNull);
      // 一般の会話には、保留して送らなかった発言を混ぜない
      expect((client.bodiesOf('/copilot/chat').single as Map)['conversationHistory'], isEmpty);
      expect(client.paths, isNot(contains('/copilot/chat/7/history')));
    });

    test('履歴の読み込み中に相談を終えたら、読み込みが終わっても保留した発言は送らず、何も並べない',
        () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          {'messages': _pastMessages(4)}
        ],
        '/copilot/chat': [_reply('まずはログを見ましょう')],
      });
      final gate = client.gates['/copilot/chat/7/history'] = Completer<void>();
      await say('このバグ、どこから調べればいい？');

      final choosing = chat().chooseConsultTask(pickerId(), _task);
      await Future<void>.delayed(Duration.zero);
      expect(client.paths.last, '/copilot/chat/7/history');
      chat().exitConsult();
      final shownAtExit = state().messages.map((m) => m.text).toList();
      expect(shownAtExit.last, '「ログインのバグを直す」の相談を終えました');

      gate.complete();
      await choosing;

      expect(client.paths, isNot(contains('/copilot/chat')));
      // 「相談を終えました」のあとに履歴・発言・返信が並ばない
      expect(state().messages.map((m) => m.text).toList(), shownAtExit);
      expect(state().messages.where((m) => m.consultTaskId == '7'), isEmpty);
      expect(state().consultTask, isNull);
      expect(state().sending, isFalse);
    });

    test('対照：履歴の読み込みを待っても、相談を終えなければ保留した発言を送る', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          {'messages': _pastMessages(4)}
        ],
        '/copilot/chat': [_reply('まずはログを見ましょう')],
      });
      final gate = client.gates['/copilot/chat/7/history'] = Completer<void>();
      await say('このバグ、どこから調べればいい？');

      final choosing = chat().chooseConsultTask(pickerId(), _task);
      await Future<void>.delayed(Duration.zero);
      expect(client.paths, isNot(contains('/copilot/chat')));

      gate.complete();
      await choosing;

      expect(client.paths.last, '/copilot/chat');
      final body = client.bodiesOf('/copilot/chat').single as Map;
      expect(body['message'], 'このバグ、どこから調べればいい？');
      expect((body['conversationHistory'] as List), hasLength(4));
      expect(state().messages.last.text, 'まずはログを見ましょう');
      expect(state().consultTask?.id, '7');
    });

    test('履歴の読み込みが失敗しても、その間に相談を終えていたら何も並べない', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
        '/copilot/chat/7/history': [
          const _Status(500, {'error': 'db'})
        ],
        '/copilot/chat': [_reply('まずはログを見ましょう')],
      });
      final gate = client.gates['/copilot/chat/7/history'] = Completer<void>();
      await say('このバグ、どこから調べればいい？');

      final choosing = chat().chooseConsultTask(pickerId(), _task);
      await Future<void>.delayed(Duration.zero);
      chat().exitConsult();
      gate.complete();
      await choosing;

      expect(client.paths, isNot(contains('/copilot/chat')));
      expect(state().messages.last.text, '「ログインのバグを直す」の相談を終えました');
      expect(state().sending, isFalse);
    });

    test('「やめる」でカードを閉じる', () async {
      setUpWith({
        '/assistant/route': [_consultRoute],
      });
      await say('このバグ、どこから調べればいい？');

      chat().dismissConsultPicker(pickerId());

      expect(state().messages.last.consultPicker!.phase, RapiConsultPickPhase.closed);
      expect(state().consultTask, isNull);
    });
  });

  test('候補は更新日時の新しい順に最大5件', () {
    final tasks = [
      for (var i = 0; i < 10; i++)
        Task(
          id: '$i',
          title: 't$i',
          status: 'todo',
          priority: 'medium',
          createdAt: DateTime(2026, 11, 1),
          updatedAt: DateTime(2026, 11, 1 + (i * 7) % 10),
        )
    ];
    final picked = rapiConsultCandidates(tasks);
    expect(picked, hasLength(rapiConsultCandidateLimit));
    for (var i = 1; i < picked.length; i++) {
      expect(picked[i - 1].updatedAt.isBefore(picked[i].updatedAt), isFalse);
    }
  });
}
