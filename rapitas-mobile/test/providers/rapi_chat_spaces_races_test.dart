import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/connection_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_spaces_provider.dart';
import 'package:rapitas_mobile/services/rapi_chat_space_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_space_fakes.dart';
import '../support/rapi_space_harness.dart';

// 会話スペースの非同期の競合（nav39 直し回1：FE-1〜FE-4）。応答の順番をテストが決める。

const _hostA = 'http://localhost:3001';
const _hostB = 'http://192.168.1.9:3001';

Future<void> _microtasks([int n = 20]) async {
  for (var i = 0; i < n; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// 実際に接続設定を書き換える（設定画面で保存したのと同じ経路）
Future<void> _useHost(SpaceApp app, String url) async {
  while (!app.c.read(connectionSettingsProvider).loaded) {
    await Future<void>.delayed(Duration.zero);
  }
  await app.c.read(connectionSettingsProvider.notifier).save(baseUrl: url);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeSpaceServer server;
  late Map<String, String> prefs;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    server = FakeSpaceServer();
    prefs = {};
  });

  RapiSpaceSummary summary(FakeSpace s) => RapiSpaceSummary(id: s.id, title: s.title);

  group('FE-1 新しい会話へ移ったら、移る前の読み込みの結果を捨てる', () {
    test('開いている途中で「＋ 新しい会話」', () async {
      final a = server.seed(messages: 2);
      final app = await SpaceApp(server, prefs).start();
      server.loadGate = Completer<void>();
      await app.spaces.openSpace(summary(a));
      expect(app.spacesState.loading, isTrue);
      expect(app.spaces.newConversation(), RapiSwitchOutcome.switched);
      server.loadGate!.complete();
      await app.settle();
      expect(app.texts, isEmpty);
      expect(app.spacesState.isNew, isTrue);
      expect(app.spacesState.loading, isFalse);
      app.dispose();
    });

    test('「前の会話を読み込む」の途中で「＋ 新しい会話」', () async {
      final s = server.seed(messages: 70);
      prefs['rapiLastSpaceId.v1:$_hostA'] = 'space:${s.id}';
      final app = await SpaceApp(server, prefs).start();
      server.loadGate = Completer<void>();
      final more = app.spaces.loadMore();
      expect(app.spacesState.loadingMore, isTrue);
      expect(app.spaces.newConversation(), RapiSwitchOutcome.switched);
      server.loadGate!.complete();
      await more;
      await app.settle();
      expect(app.texts, isEmpty);
      expect(app.spacesState.loadingMore, isFalse);
      app.dispose();
    });
  });

  test('FE-2 保存前の状態を読んだ GET の応答より先に PUT が通っても、保存待ちだった発言は並ぶ', () async {
    final s = server.seed(messages: 2);
    prefs['rapiLastSpaceId.v1:$_hostA'] = 'space:${s.id}';
    server.offline = true;
    final first = await SpaceApp(server, prefs).start();
    first.assistant.offline = true;
    await first.say('圏外の発言');
    first.dispose();

    server.offline = false;
    server.loadGateAfterRead = Completer<void>();
    final app = SpaceApp(server, prefs);
    final starting = app.spaces.start();
    await _microtasks();
    // GET は保存前の2件を読んで止まっている。その間に PUT が通り、保存待ちは空になった
    expect(rowTexts(s), ['発言 ${s.id}-0', '発言 ${s.id}-1', '圏外の発言', '送信に失敗しました']);
    expect(app.spaces.queue!.isEmpty, isTrue);
    server.loadGateAfterRead!.complete();
    await starting;
    await app.settle();
    expect(app.texts, ['発言 ${s.id}-0', '発言 ${s.id}-1', '圏外の発言', '送信に失敗しました']);
    app.dispose();
  });

  test('FE-2 保存待ちの更新・削除も、保存前の状態を読んだ GET の応答に負けない', () async {
    final s = server.seed(messages: 3);
    prefs['rapiLastSpaceId.v1:$_hostA'] = 'space:${s.id}';
    final updated = SavedMessage(
        clientId: 'seed-${s.id}-1', role: 'assistant', text: '更新後', inHistory: true,
        createdAt: DateTime.utc(2026, 11, 12, 9, 0, 1));
    prefs['rapiChatPendingSaves.v1:$_hostA'] = jsonEncode([
      {
        'spaceId': s.id,
        'items': [updated.toJson(), SavedMessage.deletion('seed-${s.id}-2').toJson()],
      }
    ]);
    server.loadGateAfterRead = Completer<void>();
    final app = SpaceApp(server, prefs);
    final starting = app.spaces.start();
    await _microtasks();
    // GET は保存前の3件を読んで止まっている。その間に PUT が通り、保存待ちは空になった
    expect(rowTexts(s), ['発言 ${s.id}-0', '更新後']);
    expect(app.spaces.queue!.isEmpty, isTrue);
    server.loadGateAfterRead!.complete();
    await starting;
    await app.settle();
    expect(app.texts, ['発言 ${s.id}-0', '更新後'], reason: '古い本文も、消した行も並べない');
    app.dispose();
  });

  group('FE-3 接続先の変更', () {
    late FakeSpaceServer other;
    late SpaceApp app;

    setUp(() {
      other = FakeSpaceServer();
      app = SpaceApp(server, prefs,
          serviceOf: (ref) => ref.watch(connectionSettingsProvider).baseUrl == _hostB ? other : server);
    });

    tearDown(() => app.dispose());

    test('接続先を替えると、その接続先の会話と保存先で始め直し、戻すと元の会話が開く', () async {
      await app.start();
      await app.say('Aの話');
      final a = server.spaces.values.single;

      await _useHost(app, _hostB);
      await app.spaces.restartIfConnectionChanged();
      await app.settle();
      expect(app.spaces.connection, _hostB);
      expect(app.spacesState.isNew, isTrue);
      expect(app.texts, isEmpty);
      await app.say('Bの話');
      expect(rowTexts(other.spaces.values.single), ['Bの話', 'はい（Bの話）']);
      expect(rowTexts(a), ['Aの話', 'はい（Aの話）'], reason: 'B の発言は A に送らない');
      expect(server.spaces, hasLength(1));

      await _useHost(app, _hostA);
      await app.spaces.restartIfConnectionChanged();
      await app.settle();
      expect(app.spacesState.spaceId, a.id);
      expect(app.texts, ['Aの話', 'はい（Aの話）']);
    });

    test('応答待ちの間に替えたら、応答が終わったところで始め直す（最後の応答は前の接続先に残る）', () async {
      await app.start();
      await app.say('最初');
      final a = server.spaces.values.single;
      final gate = Completer<void>();
      app.assistant.chatGate = gate;
      app.chat.setInput('待つ');
      final sending = app.chat.send();
      await _microtasks(2);
      expect(app.spaces.busy, isTrue);

      await _useHost(app, _hostB);
      await app.spaces.restartIfConnectionChanged();
      expect(app.spaces.connection, _hostA, reason: '応答待ちの間は切り替えない');

      gate.complete();
      await sending;
      await app.settle();
      expect(app.spaces.connection, _hostB);
      expect(app.spacesState.isNew, isTrue);
      expect(app.texts, isEmpty);
      expect(other.spaces, isEmpty);

      await _useHost(app, _hostA);
      await app.spaces.restartIfConnectionChanged();
      await app.settle();
      expect(rowTexts(a), ['最初', 'はい（最初）', '待つ', 'はい（待つ）']);
      expect(app.texts, ['最初', 'はい（最初）', '待つ', 'はい（待つ）']);
    });

    test('前の接続先の遅れた保存の応答は、同じ番号の新しい接続先のスペースに作用しない', () async {
      final b = other.seed(title: 'Bの会話', messages: 1);
      prefs['rapiLastSpaceId.v1:$_hostB'] = 'space:${b.id}';
      await app.start();
      server.putGate = Completer<void>();
      app.chat.setInput('Aの話');
      await app.chat.send();
      app.clock.runAll();
      await _microtasks();
      final a = server.spaces.values.single;
      expect(a.id, b.id, reason: 'どちらの接続先でも 1 番');
      expect(app.spacesState.spaceId, a.id);

      await _useHost(app, _hostB);
      await app.spaces.restartIfConnectionChanged();
      await app.settle();
      expect(app.spacesState.spaceId, b.id);
      expect(app.spacesState.title, 'Bの会話');

      server.putGate!.complete();
      await _microtasks();
      app.clock.runAll();
      await _microtasks();
      expect(rowTexts(a), contains('Aの話'), reason: '送っていた1件は前の接続先に保存される');
      expect(app.spacesState.title, 'Bの会話');
      expect(app.spacesState.spaceId, b.id);
      expect(app.texts, ['発言 ${b.id}-0']);
      expect(app.clock.pending, isEmpty, reason: '閉じた列は再送を予約しない');
    });
  });

  group('FIX2-1 A→B→A の往復', () {
    late FakeSpaceServer other;
    RapiChatSpaceService pick(Ref ref) =>
        ref.watch(connectionSettingsProvider).baseUrl == _hostB ? other : server;

    setUp(() => other = FakeSpaceServer());

    test('前の A の列の遅れた応答は、戻った A で積んだ保存待ちを上書きせず、A で保存が進む', () async {
      final app = SpaceApp(server, prefs, serviceOf: pick);
      await app.start();
      await app.say('最初');
      final a = server.spaces.values.single;
      // A の PUT の応答を止めたまま B へ移り、A へ戻る
      final delayed = server.putGate = Completer<void>();
      app.chat.setInput('遅れる');
      await app.chat.send();
      app.clock.runAll();
      await _microtasks();
      expect(server.puts.last.map((i) => i.text), contains('遅れる'));
      await _useHost(app, _hostB);
      await app.spaces.restartIfConnectionChanged();
      await app.settle();
      // 戻った A の送信は、別の門で止めておく（保存待ちが端末に残っている状態を作る）
      final back = server.putGate = Completer<void>();
      await _useHost(app, _hostA);
      await app.spaces.restartIfConnectionChanged();
      await _microtasks();
      expect(app.spaces.connection, _hostA);
      app.chat.setInput('戻った');
      await app.chat.send();
      await _microtasks();

      // 前の A の列への遅れた応答が返る
      delayed.complete();
      await _microtasks(40);
      expect(prefs['rapiChatPendingSaves.v1:$_hostA'], contains('戻った'),
          reason: '戻ったあとで積んだ保存待ちが、端末から消えていない');

      // ここでアプリが落ちても、次の起動で A に保存される
      app.dispose();
      server.putGate = null;
      final again = SpaceApp(server, prefs, serviceOf: pick);
      await again.start();
      await again.settle();
      expect(rowTexts(a), ['最初', 'はい（最初）', '遅れる', 'はい（遅れる）', '戻った', 'はい（戻った）']);
      expect(again.spacesState.spaceId, a.id);
      expect(prefs['rapiChatPendingSaves.v1:$_hostA'], isNull);
      back.complete();
      again.dispose();
    });

    test('戻った A は、落ちずにそのまま保存を進める', () async {
      final app = SpaceApp(server, prefs, serviceOf: pick);
      addTearDown(app.dispose);
      await app.start();
      await app.say('最初');
      final a = server.spaces.values.single;
      final delayed = server.putGate = Completer<void>();
      app.chat.setInput('遅れる');
      await app.chat.send();
      app.clock.runAll();
      await _microtasks();
      await _useHost(app, _hostB);
      await app.spaces.restartIfConnectionChanged();
      await app.settle();
      await _useHost(app, _hostA);
      await app.spaces.restartIfConnectionChanged();
      await _microtasks();
      app.chat.setInput('戻った');
      await app.chat.send();
      await _microtasks();
      delayed.complete();
      server.putGate = null;
      await _microtasks(40);
      await app.settle();
      expect(rowTexts(a), ['最初', 'はい（最初）', '遅れる', 'はい（遅れる）', '戻った', 'はい（戻った）']);
      expect(app.texts, ['最初', 'はい（最初）', '遅れる', 'はい（遅れる）', '戻った', 'はい（戻った）']);
      expect(prefs['rapiChatPendingSaves.v1:$_hostA'], isNull);
      expect(other.spaces, isEmpty, reason: 'A の会話を B に送らない');
    });
  });

  test('FE-4 space_limit で止めた作成は、最後に開いたのが既存のスペースでも起動時に再送する', () async {
    server.spaceLimit = 1;
    final s = server.seed(messages: 1);
    final first = await SpaceApp(server, prefs).start();
    await first.say('あふれ');
    expect(server.spaces, hasLength(1));
    await first.spaces.openSpace(summary(s));
    await first.settle();
    expect(prefs['rapiLastSpaceId.v1:$_hostA'], 'space:${s.id}');
    first.dispose();

    // 別の端末で空きができた
    server.spaceLimit = 100;
    final app = await SpaceApp(server, prefs).start();
    await app.settle();
    expect(server.spaces, hasLength(2));
    final created = server.spaces.values.firstWhere((x) => x.id != s.id);
    expect(rowTexts(created), ['あふれ', 'はい（あふれ）']);
    expect(app.spacesState.spaceId, s.id, reason: '開くのは最後に開いたスペースのまま');
    app.dispose();
  });
}
