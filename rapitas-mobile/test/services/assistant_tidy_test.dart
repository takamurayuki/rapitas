import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// ラピの「片付け（tidy）」：delete-filter / delete-draft / task-delete / task-trash restore の
// リクエストの形（50件ずつの分割を含む）と、チャットでの
// 条件／文章で候補 → チェック → 削除 → 取り消し の流れ、一部失敗の扱い。
// 形はバックエンド routes/ai/assistant-cleanup.routes.ts と routes/tasks/task-trash.routes.ts が正。

/// 送ったボディを記録し、パスごとに決まった応答を返す ApiClient。
/// 応答が関数ならボディを渡して呼んだ結果を使う。[_Status] はその状態コードの badResponse を投げる。
class _RecordingApiClient implements ApiClient {
  final Map<String, List<Object>> responses;
  final List<(String, dynamic)> sent = [];

  _RecordingApiClient(this.responses);

  Response<T> _respond<T>(String path, dynamic data) {
    sent.add((path, data));
    final queue = responses[path];
    if (queue == null || queue.isEmpty) throw StateError('想定外のリクエスト: $path');
    var value = queue.length > 1 ? queue.removeAt(0) : queue.first;
    if (value is Object Function(dynamic)) value = value(data);
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
    if (value is AssistantTimeoutException) throw value;
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
  List<dynamic> bodiesOf(String path) => [for (final s in sent) if (s.$1 == path) s.$2];
}

class _Status {
  final int code;
  final Map<String, dynamic> body;
  const _Status(this.code, this.body);
}

/// task-delete に送られた id をすべて deleted（trashId = id + 1000）で返す
Object _deleteAll(dynamic body) => {
      'success': true,
      'results': [
        for (final id in (body as Map)['taskIds'] as List)
          {'taskId': id, 'outcome': 'deleted', 'trashId': (id as int) + 1000},
      ],
    };

const _filterBody = {
  'success': true,
  'matches': [
    {'id': 11, 'title': '古い調査メモ', 'status': 'cancelled', 'updatedAt': '2026-05-01T00:00:00.000Z'},
    {'id': 12, 'title': '中止した企画', 'status': 'cancelled', 'updatedAt': '2026-06-10T00:00:00.000Z'},
    {'id': 13, 'title': '重複したバグ票', 'status': 'cancelled', 'updatedAt': '2026-07-20T00:00:00.000Z'},
  ],
  'total': 3,
  'truncated': false,
  'excludedProtected': 1,
};

const _draftBody = {
  'success': true,
  'available': true,
  'candidates': [
    {'id': 21, 'title': 'ログイン画面の調査（重複）', 'status': 'todo', 'themeId': 2, 'reason': '同名のタスクが別にあるため'},
    {'id': 22, 'title': '終わった調査', 'status': 'done', 'themeId': null, 'reason': '完了済みの調査タスクのため'},
  ],
  'considered': 60,
  'unclear': ['「古いもの」がいつより前か分かりませんでした'],
};

void main() {
  group('AssistantService のリクエストの形', () {
    test('deleteFilter は POST /assistant/delete-filter {themeId, statuses, updatedBeforeDays} で一覧を読む',
        () async {
      final client = _RecordingApiClient({
        '/assistant/delete-filter': [_filterBody],
      });

      final result = await AssistantService(client)
          .deleteFilter(const TidyFilter(themeId: '7', statuses: ['cancelled', 'done'], days: 90));

      expect(client.bodyOf('/assistant/delete-filter'), {
        'themeId': 7,
        'statuses': ['cancelled', 'done'],
        'updatedBeforeDays': 90,
      });
      expect(result.matches.map((m) => m.id), ['11', '12', '13']);
      expect(result.matches.first.title, '古い調査メモ');
      expect(result.matches.first.updatedAt, DateTime.utc(2026, 5, 1));
      expect(result.total, 3);
      expect(result.truncated, isFalse);
      expect(result.excludedProtected, 1);
    });

    test('deleteFilter はすべてのテーマ・期間を問わないなら themeId / updatedBeforeDays を付けない', () async {
      final client = _RecordingApiClient({
        '/assistant/delete-filter': [_filterBody],
      });

      await AssistantService(client).deleteFilter(const TidyFilter(statuses: ['done'], days: 0));

      expect(client.bodyOf('/assistant/delete-filter'), {
        'statuses': ['done'],
      });
      // 初期値はデスクトップと同じ（中止・90日以上前）
      expect(const TidyFilter().toJson(), {
        'statuses': ['cancelled'],
        'updatedBeforeDays': 90,
      });
    });

    test('deleteDraft は POST /assistant/delete-draft {text} で候補・理由・検討件数・判断できなかったことを読む',
        () async {
      final client = _RecordingApiClient({
        '/assistant/delete-draft': [_draftBody],
      });

      final result = await AssistantService(client).deleteDraft('重複しているタスクを消して');

      expect(client.bodyOf('/assistant/delete-draft'), {'text': '重複しているタスクを消して'});
      expect(result.available, isTrue);
      expect(result.candidates.map((c) => c.id), ['21', '22']);
      expect(result.candidates.first.reason, '同名のタスクが別にあるため');
      expect(result.considered, 60);
      expect(result.unclear, ['「古いもの」がいつより前か分かりませんでした']);
    });

    test('deleteDraft の available: false（unclear なし）も読める', () async {
      final client = _RecordingApiClient({
        '/assistant/delete-draft': [
          {'success': true, 'available': false, 'candidates': [], 'considered': 60}
        ],
      });

      final result = await AssistantService(client).deleteDraft('なにか');

      expect(result.available, isFalse);
      expect(result.candidates, isEmpty);
      expect(result.considered, 60);
      expect(result.unclear, isEmpty);
    });

    test('taskDelete は POST /assistant/task-delete {confirmed: true, taskIds: 数値} で1件ずつの結果を読む',
        () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          {
            'success': true,
            'results': [
              {'taskId': 11, 'outcome': 'deleted', 'trashId': 501},
              {'taskId': 12, 'outcome': 'protected'},
              {'taskId': 13, 'outcome': 'not_found'},
              {'taskId': 14, 'outcome': 'failed'},
            ],
          }
        ],
      });

      final results = await AssistantService(client).taskDelete(['11', '12', '13', '14']);

      expect(client.bodyOf('/assistant/task-delete'), {
        'confirmed': true,
        'taskIds': [11, 12, 13, 14],
      });
      expect(results.map((r) => (r.taskId, r.outcome, r.trashId)), [
        ('11', 'deleted', 501),
        ('12', 'protected', null),
        ('13', 'not_found', null),
        ('14', 'failed', null),
      ]);
    });

    test('taskDelete は空・51件以上・数値でない id を送らない', () async {
      final client = _RecordingApiClient({});
      final service = AssistantService(client);

      for (final ids in [
        <String>[],
        [for (var i = 1; i <= 51; i++) '$i'],
        ['12', 'abc'],
      ]) {
        await expectLater(service.taskDelete(ids),
            throwsA(isA<AssistantException>().having((e) => e.code, 'code', 'invalid_task')));
      }
      expect(client.sent, isEmpty);
    });

    test('deleteTasks は 50件ずつに分けて送り、進み具合を知らせる（120件 → 50・50・20）', () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [_deleteAll],
      });
      final ids = [for (var i = 1; i <= 120; i++) '$i'];
      final progress = <(int, int)>[];

      final run = await AssistantService(client)
          .deleteTasks(ids, onProgress: (done, of) => progress.add((done, of)));

      final bodies = client.bodiesOf('/assistant/task-delete');
      expect(bodies.map((b) => ((b as Map)['taskIds'] as List).length), [50, 50, 20]);
      expect(bodies.every((b) => (b as Map)['confirmed'] == true), isTrue);
      expect((bodies.first as Map)['taskIds'], [for (var i = 1; i <= 50; i++) i]);
      expect((bodies.last as Map)['taskIds'], [for (var i = 101; i <= 120; i++) i]);
      expect(progress, [(1, 3), (2, 3), (3, 3)]);
      expect(run.deleted, hasLength(120));
      expect(run.complete, isTrue);
    });

    test('deleteTasks は途中の回が失敗したらそこで止め、送った回は不明・残りは未送信に分ける', () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          _deleteAll,
          DioException(
              requestOptions: RequestOptions(path: '/assistant/task-delete'),
              type: DioExceptionType.connectionError),
          _deleteAll,
        ],
      });
      final ids = [for (var i = 1; i <= 120; i++) '$i'];

      final run = await AssistantService(client).deleteTasks(ids);

      expect(client.bodiesOf('/assistant/task-delete'), hasLength(2));
      expect(run.deleted, hasLength(50));
      expect(run.unknown, [for (var i = 51; i <= 100; i++) '$i']);
      expect(run.unsent, [for (var i = 101; i <= 120; i++) '$i']);
      expect(run.rejected, isEmpty);
      expect(run.complete, isFalse);
    });

    test('deleteTasks：回ごと 4xx で断られたらその回は rejected（削除していない）', () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          const _Status(400, {'success': false, 'error': 'confirmation_required'}),
        ],
      });

      final run = await AssistantService(client).deleteTasks(['1', '2']);

      expect(run.rejected, ['1', '2']);
      expect(run.unknown, isEmpty);
      expect(run.results, isEmpty);
    });

    test('deleteTasks：結果に載らなかった id と 5xx の回は不明', () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          {
            'success': true,
            'results': [
              {'taskId': 1, 'outcome': 'deleted', 'trashId': 9},
              // 送っていない id・知らない outcome は捨てる
              {'taskId': 99, 'outcome': 'deleted', 'trashId': 10},
              {'taskId': 2, 'outcome': 'exploded'},
            ],
          },
        ],
      });
      var run = await AssistantService(client).deleteTasks(['1', '2']);
      expect(run.deleted.map((d) => d.taskId), ['1']);
      expect(run.unknown, ['2']);

      final failing = _RecordingApiClient({
        '/assistant/task-delete': [
          const _Status(500, {'success': false, 'error': 'internal'}),
        ],
      });
      run = await AssistantService(failing).deleteTasks(['1', '2']);
      expect(run.unknown, ['1', '2']);
      expect(run.rejected, isEmpty);
    });

    test('deleteTasks：途中の回が success:true でも結果が空なら、そこで止めてその回は不明・後続は未送信（120件で2回目が空）',
        () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          _deleteAll,
          {'success': true, 'results': <Object>[]},
          _deleteAll,
        ],
      });
      final ids = [for (var i = 1; i <= 120; i++) '$i'];
      final progress = <(int, int)>[];

      final run = await AssistantService(client)
          .deleteTasks(ids, onProgress: (done, of) => progress.add((done, of)));

      // 3回目は送らない
      expect(client.bodiesOf('/assistant/task-delete'), hasLength(2));
      expect(run.deleted.map((d) => d.taskId), [for (var i = 1; i <= 50; i++) '$i']);
      expect(run.unknown, [for (var i = 51; i <= 100; i++) '$i']);
      expect(run.unsent, [for (var i = 101; i <= 120; i++) '$i']);
      expect(run.rejected, isEmpty);
      expect(run.complete, isFalse);
      expect(progress, [(1, 3)]);
    });

    test('deleteTasks：途中の回の結果が一部欠け・未知の outcome なら、届いた結果は残し、欠けた分だけ不明・後続は未送信',
        () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          _deleteAll,
          (dynamic body) => {
                'success': true,
                'results': [
                  for (final id in ((body as Map)['taskIds'] as List).cast<int>())
                    if (id == 51)
                      {'taskId': id, 'outcome': 'exploded'} // 未知の outcome
                    else if (id == 52)
                      {'taskId': id, 'outcome': 'protected'}
                    else if (id < 99) // 99・100 は結果なし
                      {'taskId': id, 'outcome': 'deleted', 'trashId': id + 1000},
                ],
              },
          _deleteAll,
        ],
      });
      final ids = [for (var i = 1; i <= 120; i++) '$i'];

      final run = await AssistantService(client).deleteTasks(ids);

      expect(client.bodiesOf('/assistant/task-delete'), hasLength(2));
      expect(run.deleted, hasLength(50 + 46)); // 1〜50 と 53〜98
      expect(run.refused.map((r) => r.taskId), ['52']);
      expect(run.unknown, ['51', '99', '100']);
      expect(run.unsent, [for (var i = 101; i <= 120; i++) '$i']);
      expect(run.rejected, isEmpty);
    });

    test('deleteTasks：最後の回の結果が欠けても未送信は無く、欠けた分だけ不明', () async {
      final client = _RecordingApiClient({
        '/assistant/task-delete': [
          _deleteAll,
          {
            'success': true,
            'results': [
              {'taskId': 51, 'outcome': 'deleted', 'trashId': 1051},
            ],
          },
        ],
      });
      final ids = [for (var i = 1; i <= 52; i++) '$i'];

      final run = await AssistantService(client).deleteTasks(ids);

      expect(client.bodiesOf('/assistant/task-delete'), hasLength(2));
      expect(run.deleted, hasLength(51));
      expect(run.unknown, ['52']);
      expect(run.unsent, isEmpty);
    });

    test('restoreFromTrash は POST /task-trash/:id/restore。409 は not_restorable', () async {
      final client = _RecordingApiClient({
        '/task-trash/501/restore': [
          {'success': true, 'task': {'id': 11}},
        ],
        '/task-trash/502/restore': [
          const _Status(409, {'success': false, 'error': 'not_restorable'}),
        ],
      });
      final service = AssistantService(client);

      await service.restoreFromTrash(501);
      expect(client.sent.single.$1, '/task-trash/501/restore');

      await expectLater(
        service.restoreFromTrash(502),
        throwsA(isA<AssistantException>()
            .having((e) => e.code, 'code', 'not_restorable')
            .having((e) => e.statusCode, 'statusCode', 409)),
      );
    });
  });

  group('RapiChatNotifier の片付け（tidy）', () {
    late _RecordingApiClient client;
    late ProviderContainer container;

    void setUpWith(Map<String, List<Object>> extra) {
      client = _RecordingApiClient({
        '/assistant/route': [
          {'routed': true, 'intent': 'tidy', 'reason': '不要なタスクの削除'}
        ],
        '/assistant/delete-filter': [_filterBody],
        '/assistant/delete-draft': [_draftBody],
        '/assistant/task-delete': [_deleteAll],
        // 一覧・詳細の再読み込み（invalidate）で呼ばれても落ちないように
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
        container.read(rapiChatProvider).messages.lastWhere((m) => m.tidy != null);
    RapiTidyCard card() => cardMessage().tidy!;
    List<String> paths() => client.sent.map((s) => s.$1).toList();

    Future<int> sendTidy([String text = '中止したタスクを片付けて']) async {
      notifier().setInput(text);
      await notifier().send();
      return cardMessage().id;
    }

    test('tidy に振り分けたら片付けカード（条件で選ぶ・初期値はデスクトップと同じ）を出し、まだ何も送らない',
        () async {
      setUpWith({});

      await sendTidy();

      final messages = container.read(rapiChatProvider).messages;
      expect(messages.any((m) => m.text.contains('デスクトップ版')), isFalse);
      expect(messages.any((m) => m.text == 'タスクの片付けとして受け取りました — 不要なタスクの削除'), isTrue);
      expect(card().phase, RapiTidyPhase.setup);
      expect(card().how, RapiTidyHow.condition);
      expect(card().filter.statuses, ['cancelled']);
      expect(card().filter.days, 90);
      expect(card().text, '中止したタスクを片付けて');
      expect(paths(), ['/assistant/route']);
    });

    test('条件で選ぶ：条件を変えて delete-filter を送り、候補を全部チェック済みで出す', () async {
      setUpWith({});
      final id = await sendTidy();

      notifier().toggleTidyStatus(id, 'done');
      notifier().setTidyDays(id, 180);
      notifier().setTidyTheme(id, '7');
      await notifier().searchTidy(id);

      expect(client.bodyOf('/assistant/delete-filter'), {
        'themeId': 7,
        // 状態はデスクトップの並び（cancelled, done, …）で送る
        'statuses': ['cancelled', 'done'],
        'updatedBeforeDays': 180,
      });
      expect(card().phase, RapiTidyPhase.listing);
      expect(card().listedBy, RapiTidyHow.condition);
      expect(card().items.map((i) => i.id), ['11', '12', '13']);
      expect(card().chosen, {'11', '12', '13'});
      expect(card().total, 3);
      expect(card().excludedProtected, 1);
      expect(paths(), isNot(contains('/assistant/task-delete')));
    });

    test('状態を全部外すと探せない（空の状態は「すべての状態」になってしまうため）', () async {
      setUpWith({});
      final id = await sendTidy();

      notifier().toggleTidyStatus(id, 'cancelled');
      expect(card().filter.statuses, isEmpty);
      expect(card().canSearch, isFalse);
      await notifier().searchTidy(id);

      expect(paths(), isNot(contains('/assistant/delete-filter')));
    });

    test('文章で選ぶ：振り分けられた発言をそのまま delete-draft に送り、理由・検討件数を出す', () async {
      setUpWith({});
      final id = await sendTidy('重複しているタスクを消して');

      notifier().setTidyHow(id, RapiTidyHow.text);
      await notifier().searchTidy(id);

      expect(client.bodyOf('/assistant/delete-draft'), {'text': '重複しているタスクを消して'});
      expect(card().phase, RapiTidyPhase.listing);
      expect(card().listedBy, RapiTidyHow.text);
      expect(card().items.map((i) => i.reason),
          ['同名のタスクが別にあるため', '完了済みの調査タスクのため']);
      expect(card().chosen, {'21', '22'});
      expect(card().considered, 60);
      expect(card().unclear, hasLength(1));
    });

    test('該当なし・AI 不達は setup に戻して理由を出す（空の一覧を「消すものが無い」と見せない）', () async {
      setUpWith({
        '/assistant/delete-filter': [
          {'success': true, 'matches': [], 'total': 0, 'truncated': false, 'excludedProtected': 0}
        ],
        '/assistant/delete-draft': [
          {'success': true, 'available': false, 'candidates': [], 'considered': 60}
        ],
      });
      final id = await sendTidy();

      await notifier().searchTidy(id);
      expect(card().phase, RapiTidyPhase.setup);
      expect(card().notice, contains('該当するタスクはありませんでした'));

      notifier().setTidyHow(id, RapiTidyHow.text);
      expect(card().notice, isNull);
      await notifier().searchTidy(id);
      expect(card().phase, RapiTidyPhase.setup);
      expect(card().notice, contains('候補を挙げられませんでした'));
    });

    test('チェックを外したものは送らない（送るのは画面に出てチェックが残った id だけ）', () async {
      setUpWith({});
      final id = await sendTidy();
      await notifier().searchTidy(id);

      notifier().toggleTidyItem(id, '12');
      expect(card().chosen, {'11', '13'});
      // 一覧に無い id は選べない
      notifier().toggleTidyItem(id, '999');
      expect(card().chosen, {'11', '13'});

      await notifier().deleteTidy(id);

      expect(client.bodyOf('/assistant/task-delete'), {
        'confirmed': true,
        'taskIds': [11, 13],
      });
      expect(card().phase, RapiTidyPhase.done);
      expect(card().run!.deleted.map((d) => d.taskId), ['11', '13']);
    });

    test('すべて外すと削除できない／すべて選ぶで戻る', () async {
      setUpWith({});
      final id = await sendTidy();
      await notifier().searchTidy(id);

      notifier().setTidyAll(id, false);
      expect(card().canDelete, isFalse);
      await notifier().deleteTidy(id);
      expect(paths(), isNot(contains('/assistant/task-delete')));

      notifier().setTidyAll(id, true);
      expect(card().chosen, {'11', '12', '13'});
    });

    test('削除 → 1件ずつ戻す → まとめて戻す：trashId ごとに restore を送り、押し直しで二重に送らない', () async {
      setUpWith({
        '/task-trash/1011/restore': [
          {'success': true, 'task': {}}
        ],
        '/task-trash/1012/restore': [
          {'success': true, 'task': {}}
        ],
        '/task-trash/1013/restore': [
          {'success': true, 'task': {}}
        ],
      });
      final id = await sendTidy();
      await notifier().searchTidy(id);
      await notifier().deleteTidy(id);
      expect(card().restorable, [1011, 1012, 1013]);

      await notifier().restoreTidy(id, 1012);
      expect(card().restoreOf(1012), RapiTidyRestore.restored);
      expect(card().restorable, [1011, 1013]);

      await notifier().restoreAllTidy(id);
      expect(card().restoreOf(1011), RapiTidyRestore.restored);
      expect(card().restoreOf(1013), RapiTidyRestore.restored);
      expect(card().restorable, isEmpty);

      await notifier().restoreAllTidy(id);
      await notifier().restoreTidy(id, 1012);
      expect(paths().where((p) => p.startsWith('/task-trash/')),
          ['/task-trash/1012/restore', '/task-trash/1011/restore', '/task-trash/1013/restore']);
    });

    test('戻すの 409 は「戻せない」（押し直させない）、通信の失敗は押し直せる', () async {
      setUpWith({
        '/task-trash/1011/restore': [
          const _Status(409, {'success': false, 'error': 'not_restorable'})
        ],
        '/task-trash/1012/restore': [
          DioException(
              requestOptions: RequestOptions(path: '/task-trash/1012/restore'),
              type: DioExceptionType.connectionError),
          {'success': true, 'task': {}},
        ],
        '/task-trash/1013/restore': [
          {'success': true, 'task': {}}
        ],
      });
      final id = await sendTidy();
      await notifier().searchTidy(id);
      await notifier().deleteTidy(id);

      await notifier().restoreAllTidy(id);
      expect(card().restoreOf(1011), RapiTidyRestore.unavailable);
      expect(card().restoreOf(1012), RapiTidyRestore.failed);
      expect(card().restoreOf(1013), RapiTidyRestore.restored);
      expect(card().restorable, [1012]);

      await notifier().restoreTidy(id, 1012);
      expect(card().restoreOf(1012), RapiTidyRestore.restored);
      await notifier().restoreTidy(id, 1011);
      expect(paths().where((p) => p == '/task-trash/1011/restore'), hasLength(1));
    });

    test('一部失敗：保護・見つからない・失敗を、削除できた分と分けて持つ', () async {
      setUpWith({
        '/assistant/task-delete': [
          {
            'success': true,
            'results': [
              {'taskId': 11, 'outcome': 'deleted', 'trashId': 1011},
              {'taskId': 12, 'outcome': 'protected'},
              {'taskId': 13, 'outcome': 'failed'},
            ],
          }
        ],
      });
      final id = await sendTidy();
      await notifier().searchTidy(id);
      await notifier().deleteTidy(id);

      final run = card().run!;
      expect(run.deleted.map((d) => d.taskId), ['11']);
      expect(run.refused.map((r) => (r.taskId, r.outcome)), [('12', 'protected'), ('13', 'failed')]);
      expect(card().restorable, [1011]);
    });

    test('60件の削除が2回目で応答を失ったら、1回目の50件は削除済み・残り10件は結果不明（押し直させない）',
        () async {
      final many = {
        'success': true,
        'matches': [
          for (var i = 1; i <= 60; i++)
            {'id': i, 'title': 'タスク$i', 'status': 'cancelled', 'updatedAt': '2026-01-01T00:00:00Z'}
        ],
        'total': 60,
        'truncated': false,
        'excludedProtected': 0,
      };
      setUpWith({
        '/assistant/delete-filter': [many],
        '/assistant/task-delete': [
          _deleteAll,
          DioException(
              requestOptions: RequestOptions(path: '/assistant/task-delete'),
              type: DioExceptionType.receiveTimeout),
        ],
      });
      final id = await sendTidy();
      await notifier().searchTidy(id);
      // 畳んでいる間は画面に出た先頭20件だけが対象
      expect(card().chosenIds, hasLength(20));
      notifier().expandTidy(id);
      expect(card().chosenIds, hasLength(60));
      await notifier().deleteTidy(id);

      expect(client.bodiesOf('/assistant/task-delete').map((b) => ((b as Map)['taskIds'] as List).length),
          [50, 10]);
      final run = card().run!;
      expect(card().phase, RapiTidyPhase.done);
      expect(run.deleted, hasLength(50));
      expect(run.unknown, [for (var i = 51; i <= 60; i++) '$i']);
      // 削除後は削除のボタンが無い（押し直しても送らない）
      await notifier().deleteTidy(id);
      expect(client.bodiesOf('/assistant/task-delete'), hasLength(2));
    });

    test('「やめる」は削除前だけ下げられる。「選び直す」は候補を捨てて条件に戻る', () async {
      setUpWith({});
      final id = await sendTidy();
      await notifier().searchTidy(id);

      notifier().backToTidySetup(id);
      expect(card().phase, RapiTidyPhase.setup);
      expect(card().items, isEmpty);

      notifier().cancelTidy(id);
      expect(container.read(rapiChatProvider).messages.any((m) => m.tidy != null), isFalse);
      expect(paths(), isNot(contains('/assistant/task-delete')));
    });

    test('候補を出せなかった（タイムアウト）は setup に戻して案内する', () async {
      setUpWith({
        '/assistant/delete-filter': [
          DioException(
              requestOptions: RequestOptions(path: '/assistant/delete-filter'),
              type: DioExceptionType.receiveTimeout),
        ],
      });
      final id = await sendTidy();

      await notifier().searchTidy(id);

      expect(card().phase, RapiTidyPhase.setup);
      expect(card().error, contains('時間がかかり'));
    });
  });
}
