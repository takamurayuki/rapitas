import 'dart:async';

import 'package:dio/dio.dart';
import 'package:rapitas_mobile/config/api_config.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/rapi_chat_save_queue.dart';
import 'package:rapitas_mobile/services/rapi_chat_save_store.dart';
import 'package:rapitas_mobile/services/rapi_chat_space_service.dart';

// 会話スペースのテスト用の偽物（nav39）。
//
// - FakeSpaceServer: /rapi-chat/* と同じ決まり（clientKey の冪等・PUT の原子性と上限・ページング）を
//   メモリ上で真似る。offline の間は通信の失敗（DioException）を投げる
// - MemoryStore: SharedPreferences の代わり（アプリの再起動をまたいで同じ map を渡す）
// - ManualScheduler: 0.5秒のまとめと再送の予約を、テストが手で進める
// - FakeAssistant: 振り分けは常に chat、copilot/chat に送った history を記録する

DioException _offline(String path) => DioException(
      requestOptions: RequestOptions(path: path),
      type: DioExceptionType.connectionError,
    );

/// 偽の ApiClient（偽のサービスが親クラスの _api を使わないので、呼ばれたら失敗させる）
ApiClient fakeApiClient() => ApiClient(config: ApiConfig(baseUrl: 'http://fake.invalid:3001'));

class FakeSpace {
  final int id;
  String? title;
  final String? clientKey;
  final DateTime createdAt = DateTime.utc(2026, 11, 12, 9);
  final List<SavedMessage> rows = [];
  FakeSpace(this.id, {this.title, this.clientKey});
}

class FakeSpaceServer extends RapiChatSpaceService {
  FakeSpaceServer() : super(fakeApiClient());

  final Map<int, FakeSpace> spaces = {};
  int _nextSpace = 1;
  int _nextRow = 1;
  bool offline = false;

  /// 次の POST だけ、作成したうえで応答を失わせる（応答が失われた場合の再送の確認）
  bool loseNextCreateResponse = false;

  /// PUT だけを通信の失敗にする（POST は通す）
  bool putOffline = false;

  /// GET messages だけを通信の失敗にする
  bool loadOffline = false;

  /// 完了するまで GET messages の応答を止める（読み込み中の確認用）
  Completer<void>? loadGate;

  /// GET messages の中身を読んだあと、完了するまで応答を止める（保存前の状態を読んだ GET の確認用）
  Completer<void>? loadGateAfterRead;

  /// 完了するまで PUT の応答を止める（中身はまだ保存しない）
  Completer<void>? putGate;
  int spaceLimit = 100;
  int messageLimit = 2000;
  final List<String> calls = [];
  final List<List<SavedMessage>> puts = [];

  /// 1回の PUT の中身で 400 を返すかを決める（既定は clientId が 'BAD' の項目があるとき）
  bool Function(List<SavedMessage> items) malformed =
      (items) => items.any((i) => i.clientId == 'BAD');

  FakeSpace seed({String? title, int messages = 0, bool inHistory = true}) {
    final s = FakeSpace(_nextSpace++, title: title);
    spaces[s.id] = s;
    for (var i = 0; i < messages; i++) {
      s.rows.add(SavedMessage(
        clientId: 'seed-${s.id}-$i',
        role: i.isEven ? 'user' : 'assistant',
        text: '発言 ${s.id}-$i',
        inHistory: inHistory,
        serverId: _nextRow++,
        createdAt: DateTime.utc(2026, 11, 12, 9, 0, i),
      ));
    }
    return s;
  }

  /// 行を直接足す（turns の確保などの確認用）
  void addRow(FakeSpace s, SavedMessage m) => s.rows.add(SavedMessage(
        clientId: m.clientId,
        role: m.role,
        kind: m.kind,
        text: m.text,
        inHistory: m.inHistory,
        payload: m.payload,
        serverId: _nextRow++,
        createdAt: DateTime.utc(2026, 11, 12, 10),
      ));

  RapiSpaceSummary _summary(FakeSpace s) =>
      RapiSpaceSummary(id: s.id, title: s.title, messageCount: s.rows.length, createdAt: s.createdAt);

  @override
  Future<List<RapiSpaceSummary>> listSpaces() async {
    calls.add('GET /spaces');
    if (offline) throw _offline('/rapi-chat/spaces');
    return [for (final s in spaces.values.toList().reversed) _summary(s)];
  }

  @override
  Future<RapiCreateResult> createSpace({required String clientKey}) async {
    calls.add('POST $clientKey');
    if (offline) throw _offline('/rapi-chat/spaces');
    for (final s in spaces.values) {
      if (s.clientKey == clientKey) return RapiCreated(_summary(s));
    }
    if (spaces.length >= spaceLimit) return const RapiSpaceLimit();
    final s = FakeSpace(_nextSpace++, clientKey: clientKey);
    spaces[s.id] = s;
    if (loseNextCreateResponse) {
      loseNextCreateResponse = false;
      throw _offline('/rapi-chat/spaces');
    }
    return RapiCreated(_summary(s));
  }

  @override
  Future<void> deleteSpace(int id) async {
    calls.add('DELETE $id');
    if (offline) throw _offline('/rapi-chat/spaces/$id');
    spaces.remove(id);
  }

  @override
  Future<RapiMessagePage> loadMessages(int spaceId, {int? before, int limit = 50}) async {
    calls.add('GET $spaceId before=$before limit=$limit');
    if (loadGate != null) await loadGate!.future;
    if (offline || loadOffline) throw _offline('/rapi-chat/spaces/$spaceId/messages');
    final s = spaces[spaceId];
    if (s == null) throw const RapiSpaceNotFound();
    final older = [for (final r in s.rows) if (before == null || r.serverId! < before) r];
    final page = older.length > limit ? older.sublist(older.length - limit) : older;
    if (loadGateAfterRead != null) await loadGateAfterRead!.future;
    return RapiMessagePage(
      messages: page,
      hasMore: older.length > limit,
      nextBefore: page.isEmpty ? null : page.first.serverId,
    );
  }

  @override
  Future<RapiPutResult> putMessages(int spaceId, List<SavedMessage> items) async {
    calls.add('PUT $spaceId ${items.length}');
    puts.add(items);
    if (putGate != null) await putGate!.future;
    if (offline || putOffline) throw _offline('/rapi-chat/spaces/$spaceId/messages');
    final s = spaces[spaceId];
    if (s == null) return const RapiPutGone();
    if (malformed(items)) return const RapiPutMalformed();
    final invalid = [for (final i in items) if (i.text == 'INVALID') i.clientId];
    if (invalid.isNotEmpty) return RapiPutInvalid(invalid);
    final existing = {for (final r in s.rows) r.clientId};
    final creates = [for (final i in items) if (!i.deleted && !existing.contains(i.clientId)) i];
    final deletes = [for (final i in items) if (i.deleted && existing.contains(i.clientId)) i];
    if (s.rows.length + creates.length - deletes.length > messageLimit) {
      final remaining = messageLimit - (s.rows.length - deletes.length);
      return RapiPutLimit(remaining < 0 ? 0 : remaining, [for (final c in creates) c.clientId]);
    }
    for (final i in items) {
      final at = s.rows.indexWhere((r) => r.clientId == i.clientId);
      if (i.deleted) {
        if (at >= 0) s.rows.removeAt(at);
        continue;
      }
      final row = SavedMessage(
        clientId: i.clientId,
        role: i.role,
        kind: i.kind,
        text: i.text,
        taskId: i.taskId,
        inHistory: i.inHistory,
        payload: i.payload,
        serverId: at >= 0 ? s.rows[at].serverId : _nextRow++,
        createdAt: DateTime.utc(2026, 11, 12, 11),
      );
      if (at >= 0) {
        s.rows[at] = row;
      } else {
        s.rows.add(row);
      }
    }
    if (s.title == null) {
      for (final r in s.rows) {
        if (r.role == 'user' && r.kind == 'text') {
          s.title = r.text.length > 20 ? '${r.text.substring(0, 19)}…' : r.text;
          break;
        }
      }
    }
    return RapiPutSaved(title: s.title);
  }
}

class MemoryStore implements RapiSaveStore {
  final Map<String, String> map;
  final String key;
  MemoryStore(this.map, this.key);

  @override
  Future<String?> read() async => map[key];

  @override
  Future<void> write(String value) async {
    if (value.isEmpty || value == '[]') {
      map.remove(key);
    } else {
      map[key] = value;
    }
  }
}

class ManualScheduler {
  final List<(Duration, void Function())> pending = [];

  RapiCancel call(Duration delay, void Function() run) {
    final entry = (delay, run);
    pending.add(entry);
    return () => pending.remove(entry);
  }

  /// 予約されている処理をすべて走らせる（走らせた数）
  int runAll() {
    final now = [...pending];
    pending.clear();
    for (final e in now) {
      e.$2();
    }
    return now.length;
  }

  List<Duration> get delays => [for (final e in pending) e.$1];
}

class FakeAssistant extends AssistantService {
  FakeAssistant() : super(fakeApiClient());

  final List<List<Map<String, String>>> histories = [];

  /// 書き込み系の呼び出し（記録のカードから要求が出ていないことの確認用）
  final List<String> writes = [];
  bool offline = false;
  String reply = 'はい';

  /// 完了するまで chat の応答を止める（応答待ちの間の切り替えの確認用）
  Completer<void>? chatGate;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    if (offline) throw _offline('/assistant/route');
    return RoutedIntent(intent: text.startsWith('相談') ? 'consult' : 'chat');
  }

  @override
  Future<CopilotReply> chat(String message, {List<Map<String, String>> history = const []}) async {
    histories.add(history);
    if (chatGate != null) await chatGate!.future;
    return CopilotReply(content: '$reply（$message）');
  }

  @override
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async => const [];

  @override
  Future<CopilotReply> copilotChat(String message,
          {required String taskId, List<Map<String, String>> history = const []}) async =>
      CopilotReply(content: '相談の返事（$message）');

  Never _write(String name) {
    writes.add(name);
    throw _offline(name);
  }

  @override
  Future<TaskUpdateResult> taskUpdate(String taskId, TaskChanges changes) async => _write('taskUpdate');
  @override
  Future<TaskUpdateRevert> revertTaskUpdate(int actionId) async => _write('revert');
  @override
  Future<void> companionApply(RapiCompanionAction action, String taskId) async =>
      _write('companionApply');
  @override
  Future<RoadmapDraft?> roadmapDraft(String text, {List<RoadmapAnswer> answers = const []}) async =>
      _write('roadmapDraft');
  @override
  Future<RoadmapCommitResult> roadmapCommit(RoadmapDraft draft) async => _write('roadmapCommit');
  @override
  Future<DeleteFilterResult> deleteFilter(TidyFilter filter) async => _write('deleteFilter');
  @override
  Future<DeleteDraftResult> deleteDraft(String text) async => _write('deleteDraft');
  @override
  Future<TaskDeleteRun> deleteTasks(List<String> taskIds,
          {void Function(int done, int of)? onProgress}) async =>
      _write('deleteTasks');
  @override
  Future<void> restoreFromTrash(int trashId) async => _write('restore');
}
