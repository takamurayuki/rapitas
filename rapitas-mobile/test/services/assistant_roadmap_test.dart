import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// ラピの「計画（roadmap）」：roadmap/draft / roadmap/commit のリクエストの形と、
// チャットでの 下書き（質問）→ 回答 → 再下書き → 最終確認 → 作成 の流れ、失敗の扱い。
// 形はバックエンド rapitas-backend/routes/ai/assistant-roadmap.routes.ts が正。

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

const _sketchBody = {
  'success': true,
  'available': true,
  'draft': {
    'goal': '年内に英検2級に合格する',
    'themeChoice': {'kind': 'new', 'name': '英語学習', 'reason': '合う既存テーマがないため'},
    'projectChoice': {'kind': 'none', 'reason': '単発の目標のため'},
    'questions': [
      {
        'question': '1日に使える時間は？',
        'options': ['30分', '1時間', '2時間'],
        'recommended': '1時間',
        'recommendedReason': '続けやすく、試験日までに範囲を回せるため',
      },
      {
        'question': '教材は？',
        'options': ['過去問中心', '単語帳中心'],
      },
    ],
    'steps': [
      {'title': '過去問を1回分解く', 'description': '現状の点数を知る'},
    ],
    'deadline': '2026-12-20',
    'assumptions': ['平日も学習できる'],
    'comparisonAxes': [],
  },
};

const _finalBody = {
  'success': true,
  'available': true,
  'draft': {
    'goal': '年内に英検2級に合格する',
    'themeChoice': {'kind': 'new', 'name': '英語学習', 'reason': '合う既存テーマがないため'},
    'projectChoice': {'kind': 'existing', 'id': 4, 'name': '資格'},
    'questions': [],
    'steps': [
      {'title': '過去問を1回分解く', 'description': '現状の点数を知る。完了：採点まで', 'dueDate': '2026-11-15'},
      {'title': '単語を毎日1時間', 'description': '完了：単語帳を1周'},
    ],
    'deadline': '2026-12-20',
    'assumptions': [],
    'comparisonAxes': [],
  },
};

const _committedBody = {
  'success': true,
  'themeId': 12,
  'projectId': 4,
  'taskIds': [101, 102],
  'failedAfter': null,
};

void main() {
  group('AssistantService のリクエストの形', () {
    test('roadmapDraft は POST /assistant/roadmap/draft {text} で、下書きを読む', () async {
      final client = _RecordingApiClient({
        '/assistant/roadmap/draft': [_sketchBody],
      });

      final draft = await AssistantService(client).roadmapDraft('年内に英検2級を取りたい');

      // 1回目は answers を付けない
      expect(client.bodyOf('/assistant/roadmap/draft'), {'text': '年内に英検2級を取りたい'});
      expect(draft!.goal, '年内に英検2級に合格する');
      expect(draft.themeChoice.isNew, isTrue);
      expect(draft.themeChoice.name, '英語学習');
      expect(draft.projectChoice.isNone, isTrue);
      expect(draft.questions, hasLength(2));
      expect(draft.questions.first.initialAnswer, '1時間');
      // 推奨が無い質問は先頭の選択肢から
      expect(draft.questions[1].initialAnswer, '過去問中心');
      expect(draft.deadline, '2026-12-20');
      expect(draft.hasQuestions, isTrue);
    });

    test('roadmapDraft は answers を [{question, answer}] で付け、200字・6件に収める', () async {
      final client = _RecordingApiClient({
        '/assistant/roadmap/draft': [_finalBody],
      });
      final long = 'あ' * 250;

      await AssistantService(client).roadmapDraft('年内に英検2級を取りたい', answers: [
        const RoadmapAnswer(question: '1日に使える時間は？', answer: '1時間'),
        const RoadmapAnswer(question: '教材は？', answer: ''),
        RoadmapAnswer(question: long, answer: long),
        for (var i = 0; i < 5; i++) RoadmapAnswer(question: 'Q$i', answer: 'A$i'),
      ]);

      final body = client.bodyOf('/assistant/roadmap/draft') as Map;
      expect(body['text'], '年内に英検2級を取りたい');
      final answers = body['answers'] as List;
      expect(answers, hasLength(6));
      expect(answers[0], {'question': '1日に使える時間は？', 'answer': '1時間'});
      // 空の答えは「—」（サーバーは minLength 1）
      expect(answers[1], {'question': '教材は？', 'answer': '—'});
      expect((answers[2] as Map)['question'], hasLength(200));
      expect((answers[2] as Map)['answer'], hasLength(200));
    });

    test('roadmapDraft の available: false は null', () async {
      final client = _RecordingApiClient({
        '/assistant/roadmap/draft': [
          {'success': true, 'available': false}
        ],
      });

      expect(await AssistantService(client).roadmapDraft('なにか'), isNull);
    });

    test('roadmapCommit は confirmed: true・goal・各選択・steps をそのまま送り、結果を読む', () async {
      final client = _RecordingApiClient({
        '/assistant/roadmap/draft': [_finalBody],
        '/assistant/roadmap/commit': [_committedBody],
      });
      final service = AssistantService(client);
      final draft = (await service.roadmapDraft('年内に英検2級を取りたい'))!;

      final result = await service.roadmapCommit(draft);

      expect(client.bodyOf('/assistant/roadmap/commit'), {
        'confirmed': true,
        'goal': '年内に英検2級に合格する',
        'themeChoice': {'kind': 'new', 'name': '英語学習', 'reason': '合う既存テーマがないため'},
        'projectChoice': {'kind': 'existing', 'id': 4, 'name': '資格'},
        'steps': [
          {'title': '過去問を1回分解く', 'description': '現状の点数を知る。完了：採点まで', 'dueDate': '2026-11-15'},
          // 期限の無い手順は dueDate を付けない（null は送らない）
          {'title': '単語を毎日1時間', 'description': '完了：単語帳を1周'},
        ],
      });
      expect(result.themeId, 12);
      expect(result.projectId, 4);
      expect(result.taskIds, ['101', '102']);
      expect(result.failedAfter, isNull);
    });

    test('置き場所 none は {kind: none} だけを送る', () {
      expect(RoadmapPlacement.fromJson({'kind': 'none'}).toJson(), {'kind': 'none'});
      // 読めない形（id の無い existing・名前の無い new）は「置かない」に倒す
      expect(RoadmapPlacement.fromJson({'kind': 'existing'}).isNone, isTrue);
      expect(RoadmapPlacement.fromJson({'kind': 'new', 'name': ' '}).isNone, isTrue);
    });

    test('roadmapCommit の 400 は error と状態コード付きの AssistantException', () async {
      final client = _RecordingApiClient({
        '/assistant/roadmap/draft': [_finalBody],
        '/assistant/roadmap/commit': [
          const _Status(400, {'success': false, 'error': 'confirmation_required'})
        ],
      });
      final service = AssistantService(client);
      final draft = (await service.roadmapDraft('x'))!;

      await expectLater(
        service.roadmapCommit(draft),
        throwsA(isA<AssistantException>()
            .having((e) => e.code, 'code', 'confirmation_required')
            .having((e) => e.statusCode, 'statusCode', 400)),
      );
    });
  });

  group('roadmapCommit の作成結果の検証（形・辻褄が合わなければ unexpected_response）', () {
    // _finalBody の手順は2件
    final malformed = <String, Map<String, dynamic>>{
      'failedAfter が文字列': {..._committedBody, 'taskIds': [101], 'failedAfter': '1'},
      'failedAfter が負数': {..._committedBody, 'taskIds': <int>[], 'failedAfter': -1},
      'failedAfter が手順数を超える': {..._committedBody, 'taskIds': [101, 102], 'failedAfter': 3},
      'failedAfter が手順数と同じ（止まった手順が無い）': {
        ..._committedBody,
        'taskIds': [101, 102],
        'failedAfter': 2
      },
      'failedAfter が作成件数と食い違う': {..._committedBody, 'taskIds': [101], 'failedAfter': 0},
      'failedAfter が小数': {..._committedBody, 'taskIds': [101], 'failedAfter': 1.5},
      'taskIds に文字列が混ざる': {..._committedBody, 'taskIds': [101, '102']},
      'taskIds に null が混ざる': {..._committedBody, 'taskIds': [101, null]},
      'taskIds が手順数より多い': {..._committedBody, 'taskIds': [101, 102, 103]},
      'taskIds が無い': {'success': true, 'themeId': 12, 'projectId': 4, 'failedAfter': null},
      'themeId が文字列': {..._committedBody, 'themeId': '12'},
      'projectId が文字列': {..._committedBody, 'projectId': '4'},
      'success が無い': {'themeId': 12, 'projectId': 4, 'taskIds': [101, 102]},
    };
    for (final entry in malformed.entries) {
      test(entry.key, () async {
        final client = _RecordingApiClient({
          '/assistant/roadmap/draft': [_finalBody],
          '/assistant/roadmap/commit': [entry.value],
        });
        final service = AssistantService(client);
        final draft = (await service.roadmapDraft('x'))!;

        await expectLater(
          service.roadmapCommit(draft),
          throwsA(isA<AssistantException>()
              .having((e) => e.code, 'code', 'unexpected_response')
              .having((e) => e.statusCode, 'statusCode', isNull)),
        );
      });
    }

    test('正しい形は受け付ける：途中停止（0件目で停止を含む）・テーマ/プロジェクト null・キー省略', () async {
      for (final body in <Map<String, dynamic>>[
        {'success': true, 'themeId': null, 'projectId': null, 'taskIds': <int>[], 'failedAfter': 0},
        {'success': true, 'themeId': 12, 'projectId': 4, 'taskIds': [101], 'failedAfter': 1},
        {'success': true, 'taskIds': [101, 102]},
      ]) {
        final client = _RecordingApiClient({
          '/assistant/roadmap/draft': [_finalBody],
          '/assistant/roadmap/commit': [body],
        });
        final service = AssistantService(client);
        final draft = (await service.roadmapDraft('x'))!;

        final result = await service.roadmapCommit(draft);
        expect(result.taskIds, hasLength((body['taskIds'] as List).length), reason: '$body');
        expect(result.failedAfter, body['failedAfter'], reason: '$body');
      }
    });
  });

  group('RapiChatNotifier の計画（roadmap）', () {
    late _RecordingApiClient client;
    late ProviderContainer container;

    void setUpWith(Map<String, List<Object>> extra) {
      client = _RecordingApiClient({
        '/assistant/route': [
          {'routed': true, 'intent': 'roadmap', 'reason': '目標から計画を立てる依頼'}
        ],
        '/assistant/roadmap/draft': [_sketchBody, _finalBody],
        '/assistant/roadmap/commit': [_committedBody],
        '/tasks': [<dynamic>[]],
        '/themes': [<dynamic>[]],
        ...extra,
      });
      container = ProviderContainer(overrides: [
        apiClientProvider.overrideWithValue(client),
      ]);
      addTearDown(container.dispose);
    }

    RapiChatNotifier notifier() => container.read(rapiChatProvider.notifier);
    RapiMessage cardMessage() =>
        container.read(rapiChatProvider).messages.lastWhere((m) => m.roadmap != null);
    RapiRoadmapCard card() => cardMessage().roadmap!;
    List<String> paths() => client.sent.map((s) => s.$1).toList();

    Future<void> sendRoadmap() async {
      notifier().setInput('年内に英検2級を取りたい');
      await notifier().send();
    }

    test('roadmap に振り分けたら計画カード（質問・推奨が初期選択）を出し、デスクトップ版の案内は出さない',
        () async {
      setUpWith({});

      await sendRoadmap();

      final messages = container.read(rapiChatProvider).messages;
      expect(messages.any((m) => m.text.contains('デスクトップ版')), isFalse);
      expect(messages.any((m) => m.text == '計画づくりとして受け取りました — 目標から計画を立てる依頼'), isTrue);
      expect(card().phase, RapiRoadmapPhase.questions);
      expect(card().asked, hasLength(2));
      expect(card().answers, ['1時間', '過去問中心']);
      expect(card().canCommit, isFalse);
      // 下書きの段階では何も作らない
      expect(paths(), isNot(contains('/assistant/roadmap/commit')));
    });

    test('答えを選んで作り直す：同じ文に answers を付けて再下書きし、最終確認になる', () async {
      setUpWith({});
      await sendRoadmap();
      final id = cardMessage().id;

      notifier().chooseRoadmapAnswer(id, 0, '2時間');
      await notifier().refineRoadmap(id);

      expect(client.bodyOf('/assistant/roadmap/draft'), {
        'text': '年内に英検2級を取りたい',
        'answers': [
          {'question': '1日に使える時間は？', 'answer': '2時間'},
          {'question': '教材は？', 'answer': '過去問中心'},
        ],
      });
      expect(card().phase, RapiRoadmapPhase.ready);
      expect(card().draft.steps, hasLength(2));
      // 最終形は質問を返さないが、決めたことは残す
      expect(card().decisions.map((d) => d.answer), ['2時間', '過去問中心']);
      expect(card().canCommit, isTrue);
      expect(paths(), isNot(contains('/assistant/roadmap/commit')));
    });

    test('最終確認 → 作成：commit を confirmed で送り、結果をカードに出す', () async {
      setUpWith({});
      await sendRoadmap();
      final id = cardMessage().id;
      await notifier().refineRoadmap(id);

      await notifier().commitRoadmap(id);

      final sent = client.bodyOf('/assistant/roadmap/commit') as Map;
      expect(sent['confirmed'], isTrue);
      expect(sent['themeChoice'], {'kind': 'new', 'name': '英語学習', 'reason': '合う既存テーマがないため'});
      expect(sent['projectChoice'], {'kind': 'existing', 'id': 4, 'name': '資格'});
      expect((sent['steps'] as List), hasLength(2));
      expect(card().phase, RapiRoadmapPhase.committed);
      expect(card().result!.taskIds, ['101', '102']);

      // 作成後に押し直しても二重に作らない
      await notifier().commitRoadmap(id);
      expect(paths().where((p) => p == '/assistant/roadmap/commit'), hasLength(1));
    });

    test('質問の無い下書きは最初から最終確認', () async {
      setUpWith({
        '/assistant/roadmap/draft': [_finalBody],
      });

      await sendRoadmap();

      expect(card().phase, RapiRoadmapPhase.ready);
      expect(card().asked, isEmpty);
      expect(card().canCommit, isTrue);
    });

    test('下書きが作れない（available: false）なら、カードではなくラピの返信で伝える', () async {
      setUpWith({
        '/assistant/roadmap/draft': [
          {'success': true, 'available': false}
        ],
      });

      await sendRoadmap();

      final last = container.read(rapiChatProvider).messages.last;
      expect(last.roadmap, isNull);
      expect(last.role, RapiRole.assistant);
      expect(last.text, contains('計画を作れませんでした'));
    });

    test('作り直しの失敗は質問の段階に戻し、答えを残したまま案内する', () async {
      setUpWith({
        '/assistant/roadmap/draft': [
          _sketchBody,
          const _Status(500, {'error': 'boom'}),
        ],
      });
      await sendRoadmap();
      final id = cardMessage().id;
      notifier().chooseRoadmapAnswer(id, 1, '単語帳中心');

      await notifier().refineRoadmap(id);

      expect(card().phase, RapiRoadmapPhase.questions);
      expect(card().answers, ['1時間', '単語帳中心']);
      expect(card().error, contains('作り直せませんでした'));
    });

    test('commit が 302 で失敗：作成ボタンを出さず結果不明（4xx 扱いにしない）', () async {
      setUpWith({
        '/assistant/roadmap/commit': [
          const _Status(302, {'error': 'redirect'}),
          _committedBody,
        ],
      });
      await sendRoadmap();
      final id = cardMessage().id;
      await notifier().refineRoadmap(id);

      await notifier().commitRoadmap(id);

      expect(card().phase, RapiRoadmapPhase.commitUnknown);
      expect(card().canCommit, isFalse);
      expect(card().error, isNull);
      await notifier().commitRoadmap(id);
      expect(card().phase, RapiRoadmapPhase.commitUnknown);
      expect(paths().where((p) => p == '/assistant/roadmap/commit'), hasLength(1));
    });

    test('2xx で明示的な success:false も「断った」扱い：最終確認に戻し、作成し直せる', () async {
      setUpWith({
        '/assistant/roadmap/commit': [
          {'success': false, 'error': 'commit_failed'},
          _committedBody,
        ],
      });
      await sendRoadmap();
      final id = cardMessage().id;
      await notifier().refineRoadmap(id);

      await notifier().commitRoadmap(id);
      expect(card().phase, RapiRoadmapPhase.ready);
      expect(card().error, contains('何も作成していません'));
      expect(card().canCommit, isTrue);

      await notifier().commitRoadmap(id);
      expect(card().phase, RapiRoadmapPhase.committed);
    });

    test('作成をサーバーが断った（4xx）なら最終確認に戻し、作成し直せる', () async {
      setUpWith({
        '/assistant/roadmap/commit': [
          const _Status(422, {'error': 'validation'}),
          _committedBody,
        ],
      });
      await sendRoadmap();
      final id = cardMessage().id;
      await notifier().refineRoadmap(id);

      await notifier().commitRoadmap(id);
      expect(card().phase, RapiRoadmapPhase.ready);
      expect(card().error, contains('受け付けられませんでした'));
      expect(card().canCommit, isTrue);

      await notifier().commitRoadmap(id);
      expect(card().phase, RapiRoadmapPhase.committed);
    });

    test('サーバーが断ったと言い切れない作成の失敗は結果不明：作成し直させない', () async {
      DioException dio(DioExceptionType type) => DioException(
          requestOptions: RequestOptions(path: '/assistant/roadmap/commit'), type: type);
      for (final failure in <Object>[
        // 送信後に応答を受け取れなかった通信障害も connectionError になりうる
        dio(DioExceptionType.connectionError),
        dio(DioExceptionType.connectionTimeout),
        dio(DioExceptionType.sendTimeout),
        dio(DioExceptionType.receiveTimeout),
        dio(DioExceptionType.unknown),
        const _Status(500, {'error': 'boom'}),
        const _Status(503, {}),
        // 3xx はリダイレクト先で作られたかもしれない（断られたとは言えない）
        const _Status(302, {}),
        const _Status(301, {'success': false, 'error': 'moved'}),
        const _Status(304, {}),
        // 形の異常（途中停止を完了と見せない）
        {..._committedBody, 'taskIds': [101], 'failedAfter': '1'},
        {..._committedBody, 'taskIds': [101, 'x']},
      ]) {
        setUpWith({
          '/assistant/roadmap/commit': [failure],
        });
        await sendRoadmap();
        final id = cardMessage().id;
        await notifier().refineRoadmap(id);

        await notifier().commitRoadmap(id);

        expect(card().phase, RapiRoadmapPhase.commitUnknown, reason: '$failure');
        expect(card().canCommit, isFalse, reason: '$failure');
        expect(card().result, isNull, reason: '$failure');
        await notifier().commitRoadmap(id);
        expect(paths().where((p) => p == '/assistant/roadmap/commit'), hasLength(1));
      }
    });

    test('途中で止まった（failedAfter）結果もそのまま持つ', () async {
      setUpWith({
        '/assistant/roadmap/commit': [
          {'success': true, 'themeId': 12, 'projectId': 4, 'taskIds': [101], 'failedAfter': 1}
        ],
      });
      await sendRoadmap();
      final id = cardMessage().id;
      await notifier().refineRoadmap(id);

      await notifier().commitRoadmap(id);

      expect(card().phase, RapiRoadmapPhase.committed);
      expect(card().result!.stoppedPartway, isTrue);
      expect(card().result!.failedAfter, 1);
    });

    test('「やめる」で作成前のカードを下げる（何も作らない）', () async {
      setUpWith({});
      await sendRoadmap();
      final id = cardMessage().id;

      notifier().cancelRoadmap(id);

      expect(container.read(rapiChatProvider).messages.any((m) => m.roadmap != null), isFalse);
      expect(paths(), isNot(contains('/assistant/roadmap/commit')));
    });

    test('tidy は従来どおりデスクトップ版の案内', () async {
      setUpWith({
        '/assistant/route': [
          {'routed': true, 'intent': 'tidy'}
        ],
      });
      notifier().setInput('片付けて');
      await notifier().send();

      final last = container.read(rapiChatProvider).messages.last;
      expect(last.text, contains('「片付ける」の操作はデスクトップ版で対応しています'));
    });
  });
}
