import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/services/rapi_chat_save_queue.dart';
import 'package:rapitas_mobile/services/rapi_chat_space_service.dart';

import '../support/rapi_space_fakes.dart';

// 会話スペースの保存待ちの列（設計 nav39 4.3・4.4・6.5・11.2）。

class _Listener implements RapiSaveListener {
  final created = <(String, int)>[];
  final notices = <RapiSaveNotice>[];
  final gone = <int>[];
  @override
  void onSpaceCreated(String localKey, RapiSpaceSummary space) => created.add((localKey, space.id));
  @override
  void onSaved(int spaceId, String? title) {}
  @override
  void onSpaceGone(int spaceId) => gone.add(spaceId);
  @override
  void onNotice(RapiSaveNotice notice, RapiSaveTarget target) => notices.add(notice);
}

SavedMessage _m(String id, {String text = 'x', String? payload, String kind = 'text'}) =>
    SavedMessage(clientId: id, role: 'user', kind: kind, text: text, payload: payload, inHistory: true);

void main() {
  late FakeSpaceServer server;
  late ManualScheduler clock;
  late Map<String, String> prefs;
  late _Listener listener;
  var keys = 0;

  RapiChatSaveQueue queue() => RapiChatSaveQueue(
        service: server,
        store: MemoryStore(prefs, 'q'),
        newKey: () => 'key-${keys++}',
        schedule: clock.call,
        listener: listener,
      );

  setUp(() {
    server = FakeSpaceServer();
    clock = ManualScheduler();
    prefs = {};
    listener = _Listener();
    keys = 0;
  });

  test('0.5秒でまとまり、同じ clientId は最後の版だけを送る', () async {
    final s = server.seed();
    final q = queue();
    q.enqueue(RapiSaveTarget.space(s.id), _m('a', text: '1'));
    q.enqueue(RapiSaveTarget.space(s.id), _m('b'));
    q.enqueue(RapiSaveTarget.space(s.id), _m('a', text: '2'));
    expect(clock.delays, [rapiSaveDebounce]);
    expect(server.puts, isEmpty);
    clock.runAll();
    await q.flush();
    expect(server.puts.single.map((i) => (i.clientId, i.text)), [('a', '2'), ('b', 'x')]);
    expect(q.isEmpty, isTrue);
  });

  test('処理中の段階に入った項目はすぐに送る', () async {
    final s = server.seed();
    final q = queue();
    q.enqueue(RapiSaveTarget.space(s.id), _m('a'), immediate: true);
    await q.flush();
    expect(server.puts, hasLength(1));
  });

  test('通信の失敗では何も外さず、2→5→15→60秒で送り直し、書き出した分は再起動のあとで送られる', () async {
    final s = server.seed();
    server.offline = true;
    final q = queue();
    q.enqueue(RapiSaveTarget.space(s.id), _m('a'));
    // flush はまとめの予約を取り消して送る。予約された再送も、次の flush が取り消して予約し直す
    await q.flush();
    final delays = <Duration>[];
    for (var i = 0; i < 5; i++) {
      delays.add(clock.delays.single);
      await q.flush();
    }
    expect(delays, [
      const Duration(seconds: 2),
      const Duration(seconds: 5),
      const Duration(seconds: 15),
      const Duration(seconds: 60),
      const Duration(seconds: 60),
    ]);
    expect(prefs['q'], contains('"clientId":"a"'));

    // 再起動：同じ保存先から読み直して送る
    server.offline = false;
    final again = queue();
    await again.restore();
    await again.flush();
    expect(s.rows.map((r) => r.clientId), ['a']);
    expect(prefs['q'], isNull);
  });

  test('422 は rejected だけを外し、残りはすぐ送り直す。案内は1回', () async {
    final s = server.seed();
    final q = queue();
    for (final id in ['a', 'b']) {
      q.enqueue(RapiSaveTarget.space(s.id), _m(id));
    }
    q.enqueue(RapiSaveTarget.space(s.id), _m('bad', text: 'INVALID'));
    await q.flush();
    expect(s.rows.map((r) => r.clientId), ['a', 'b']);
    expect(listener.notices, [RapiSaveNotice.partial]);
    expect(q.isEmpty, isTrue);
  });

  test('409 message_limit：上書き・削除と、新規の古い順 remaining 件だけを送り直す', () async {
    final s = server.seed(messages: 3);
    server.messageLimit = 4;
    final q = queue();
    final t = RapiSaveTarget.space(s.id);
    q.enqueue(t, _m('seed-${s.id}-0', text: '確定した結果')); // 既存行の上書き
    q.enqueue(t, _m('n1'));
    q.enqueue(t, _m('n2'));
    q.enqueue(t, _m('n3'));
    await q.flush();
    expect(s.rows.map((r) => r.clientId), ['seed-${s.id}-0', 'seed-${s.id}-1', 'seed-${s.id}-2', 'n1']);
    expect(s.rows.first.text, '確定した結果');
    expect(listener.notices, [RapiSaveNotice.full]);
    expect(q.isEmpty, isTrue);
  });

  test('400：正常3件＋clientId 欠落1件は、1件ずつに分けて送り、欠落だけが外れる', () async {
    final s = server.seed();
    final q = queue();
    final t = RapiSaveTarget.space(s.id);
    // 送る前の自己検査を通り抜ける欠落（偽のサーバーは 'BAD' を clientId の欠けた項目として扱う）
    for (final id in ['a', 'BAD', 'b', 'c']) {
      q.enqueue(t, _m(id));
    }
    await q.flush();
    expect(server.puts.length, lessThanOrEqualTo(1 + 4));
    expect(s.rows.map((r) => r.clientId), ['a', 'b', 'c']);
    expect(q.isEmpty, isTrue);
    expect(listener.notices, [RapiSaveNotice.partial]);
  });

  test('400 の分割の途中で通信が失敗すると、分割をやめて未送信の項目を残し、間隔の再送に戻る', () async {
    final s = server.seed();
    final q = queue();
    final t = RapiSaveTarget.space(s.id);
    for (final id in ['a', 'BAD', 'b']) {
      q.enqueue(t, _m(id));
    }
    var calls = 0;
    server.malformed = (items) {
      calls++;
      if (calls == 3) server.putOffline = true; // 'BAD' を単独で送ったあとに落ちる
      return items.any((i) => i.clientId == 'BAD');
    };
    await q.flush();
    expect(s.rows.map((r) => r.clientId), ['a']);
    expect(q.buckets.single.items.map((i) => i.clientId), ['b']);
    expect(clock.delays, [const Duration(seconds: 2)]);
  });

  test('clientId が空の項目は送らずに外す（送る前の自己検査）', () async {
    final s = server.seed();
    final q = queue();
    q.enqueue(RapiSaveTarget.space(s.id), _m(''));
    await q.flush();
    expect(server.puts, isEmpty);
  });

  test('1回分の payload の合計が約1MB を超えないよう分ける', () async {
    final s = server.seed();
    final q = queue();
    final big = '{"v":1,"kind":"tidy","tidy":"${'a' * 250000}"}';
    for (var i = 0; i < 6; i++) {
      q.enqueue(RapiSaveTarget.space(s.id), _m('t$i', kind: 'tidy', payload: big));
    }
    await q.flush();
    expect(server.puts.map((p) => p.length), [4, 2]);
  });

  test('未作成スペース：通信の失敗でも積み、POST の再送に毎回同じ clientKey を付け、通ると宛先が替わる', () async {
    server.offline = true;
    final q = queue();
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('a'));
    await q.flush();
    expect(prefs['q'], contains('local:A'));
    await q.flush();
    server.offline = false;
    await q.flush();
    final posts = [for (final c in server.calls) if (c.startsWith('POST')) c];
    expect(posts.toSet(), {'POST key-0'});
    expect(listener.created, [('local:A', 1)]);
    expect(server.spaces[1]!.rows.map((r) => r.clientId), ['a']);
  });

  test('POST の応答が失われても、再送で同じスペースが返り2つできない', () async {
    server.loseNextCreateResponse = true;
    final q = queue();
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('a'));
    await q.flush();
    expect(server.spaces, hasLength(1));
    await q.flush();
    expect(server.spaces, hasLength(1));
    expect(server.spaces.values.single.rows.map((r) => r.clientId), ['a']);
  });

  test('POST 成功・PUT 失敗のあとで旧い宛先に積んだ分は、作られたスペースへ読み替える', () async {
    server.putOffline = true;
    final q = queue();
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('a'));
    await q.flush();
    final b = q.buckets.single;
    expect((b.spaceId, b.originLocalKey), (1, 'local:A'));
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('b'));
    expect(q.buckets.single.items.map((i) => i.clientId), ['a', 'b']);
    server.putOffline = false;
    await q.flush();
    expect(server.spaces[1]!.rows.map((r) => r.clientId), ['a', 'b']);
    expect([for (final c in server.calls) if (c.startsWith('POST')) c], hasLength(1));
  });

  test('409 space_limit では保存待ちを残し、間隔では送らず、retryBlocked で作成が進む', () async {
    server.spaceLimit = 1;
    final s = server.seed();
    final q = queue();
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('a'));
    await q.flush();
    expect(listener.notices, [RapiSaveNotice.spaceLimit]);
    expect(clock.delays, isEmpty);
    expect(q.buckets.single.localKey, 'local:A');
    server.spaces.remove(s.id);
    await q.retryBlocked();
    expect(server.spaces.values.single.rows.map((r) => r.clientId), ['a']);
  });

  test('作成前にすべて deleted になった未作成スペースは POST しない', () async {
    final q = queue();
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('a'));
    q.enqueue(const RapiSaveTarget.local('local:A'), const SavedMessage.deletion('a'));
    await q.flush();
    expect(server.calls, isEmpty);
    expect(q.isEmpty, isTrue);
  });

  test('404 のスペースの保存待ちは捨てて知らせる。既存と未作成の宛先は取り違えない', () async {
    final s = server.seed();
    final q = queue();
    q.enqueue(const RapiSaveTarget.space(999), _m('gone'));
    q.enqueue(RapiSaveTarget.space(s.id), _m('x'));
    q.enqueue(const RapiSaveTarget.local('local:A'), _m('y'));
    await q.flush();
    expect(listener.gone, [999]);
    expect(s.rows.map((r) => r.clientId), ['x']);
    final created = server.spaces.values.firstWhere((sp) => sp.id != s.id);
    expect(created.rows.map((r) => r.clientId), ['y']);
  });

  test('60秒を超えて残ったら、遅れの案内を1回だけ出す', () async {
    var now = DateTime.utc(2026, 11, 12, 12);
    final s = server.seed();
    server.offline = true;
    final q = RapiChatSaveQueue(
        service: server,
        store: MemoryStore(prefs, 'q'),
        newKey: () => 'k',
        schedule: clock.call,
        now: () => now,
        listener: listener);
    q.enqueue(RapiSaveTarget.space(s.id), _m('a'));
    await q.flush();
    expect(listener.notices, isEmpty);
    now = now.add(const Duration(seconds: 61));
    await q.flush();
    await q.flush();
    expect(listener.notices, [RapiSaveNotice.slow]);
  });
}
