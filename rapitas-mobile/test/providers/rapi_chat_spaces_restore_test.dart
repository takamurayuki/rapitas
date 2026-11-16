import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_space_fakes.dart';
import '../support/rapi_space_harness.dart';

// 会話スペースの保存と復元・turns（設計 nav39 10章 受け入れ条件 1・2、11.2「復元と turns」「turns の確保」）。

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeSpaceServer server;
  late Map<String, String> prefs;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    server = FakeSpaceServer();
    prefs = {};
  });

  test('受け入れ1：話してから終了し、起動し直すと同じスペースが同じ順で開く（記録は archived）', () async {
    final a = await SpaceApp(server, prefs).start();
    expect(a.spacesState.isNew, isTrue);
    await a.say('一つ目');
    a.chat.notice('お知らせの行');
    await a.say('二つ目');
    await a.settle();
    expect(server.spaces, hasLength(1), reason: '最初の発言でスペースが1つだけできる');
    final space = server.spaces.values.single;
    expect(rowTexts(space), ['一つ目', 'はい（一つ目）', 'お知らせの行', '二つ目', 'はい（二つ目）']);
    expect(a.spacesState.spaceId, space.id);
    expect(a.spacesState.title, '一つ目');
    final before = a.texts;
    a.dispose();

    final b = await SpaceApp(server, prefs).start();
    expect(b.spacesState.spaceId, space.id);
    expect(b.texts, before);
    expect(b.chatState.messages.where((m) => !m.localOnly).every((m) => m.archived), isTrue);
    expect(b.chatState.messages.first.localOnly, isTrue, reason: '挨拶は先頭に残る');
    b.dispose();
  });

  test('受け入れ2：読み込んだあとの一般の会話の turns に、読み込んだ発言が直近10件で入る', () async {
    final s = server.seed(messages: 14);
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    expect(app.spacesState.spaceId, s.id);
    await app.say('続きです');
    final turns = app.assistant.histories.last;
    expect(turns, hasLength(10));
    expect(turns.first['content'], '発言 ${s.id}-4');
    expect(turns.last['content'], '発言 ${s.id}-13');
    app.dispose();
  });

  test('受け入れ2：最新50件が turns に入らない行ばかりでも、前を読んで10件そろえる', () async {
    final s = server.seed(messages: 12);
    for (var i = 0; i < 60; i++) {
      server.addRow(s, SavedMessage(clientId: 'sys$i', role: 'system', text: '案内$i'));
    }
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    await app.say('次');
    expect(app.assistant.histories.last, hasLength(10));
    expect(server.calls.where((c) => c.startsWith('GET ${s.id}')), hasLength(2));
    expect(app.spacesState.hasMore, isFalse);
    app.dispose();
  });

  test('有効な発言が全体で10件未満なら、履歴の先頭まで読んで、あるだけで始める', () async {
    final s = server.seed(messages: 3);
    for (var i = 0; i < 120; i++) {
      server.addRow(s, SavedMessage(clientId: 'sys$i', role: 'system', text: '案内$i'));
    }
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    await app.say('次');
    expect(app.assistant.histories.last, hasLength(3));
    expect(app.spacesState.hasMore, isFalse);
    app.dispose();
  });

  test('追加の読み込みは最大20回で止まる（system 行ばかりで、まだ前がある場合も）', () async {
    final s = server.seed();
    // 上限で止まったことが分かるよう、20回では読み切れない件数にする（偽のサーバーは件数の上限を見ない）
    for (var i = 0; i < 2600; i++) {
      server.addRow(s, SavedMessage(clientId: 'sys$i', role: 'system', text: '案内$i'));
    }
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    expect(server.calls.where((c) => c.startsWith('GET ${s.id}')), hasLength(1 + 20));
    expect(app.spacesState.hasMore, isTrue);
    app.dispose();
  });

  test('turns の条件は rapiCountsAsTurn の1か所（読み込みの判定も同じ関数）', () {
    expect(rapiCountsAsTurn(const RapiMessage(id: 1, role: RapiRole.user, text: 'a', inHistory: true)), isTrue);
    expect(rapiCountsAsTurn(const RapiMessage(id: 1, role: RapiRole.system, text: 'a', inHistory: true)), isFalse);
    expect(rapiCountsAsTurn(const RapiMessage(id: 1, role: RapiRole.user, text: 'a')), isFalse);
    expect(rapiCountsAsTurn(const RapiMessage(id: 1, role: RapiRole.assistant, inHistory: true)), isFalse);
  });

  test('「前の会話を読み込む」で前のページが先頭に足され、重ならない', () async {
    final s = server.seed(messages: 70);
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    expect(app.spacesState.hasMore, isTrue);
    expect(app.texts.first, '発言 ${s.id}-20');
    await app.spaces.loadMore();
    expect(app.texts.first, '発言 ${s.id}-0');
    expect(app.texts, hasLength(70));
    expect(app.spacesState.hasMore, isFalse);
    app.dispose();
  });

  test('起動時に最後のスペースが消えていたら、新しい会話を開いて案内する', () async {
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:42';
    final app = await SpaceApp(server, prefs).start();
    expect(app.spacesState.isNew, isTrue);
    expect(app.chatState.messages.last.text, '前回の会話は削除されていました');
    expect(app.chatState.messages.last.localOnly, isTrue);
    app.dispose();
  });

  test('保存待ちの重ね合わせ：同じ clientId は保存待ちの版、deleted は出さない、無いものは末尾', () async {
    final s = server.seed(messages: 3);
    prefs['rapiLastSpaceId.v1:http://localhost:3001'] = 'space:${s.id}';
    prefs['rapiChatPendingSaves.v1:http://localhost:3001'] =
        '[{"spaceId":${s.id},"items":[{"clientId":"seed-${s.id}-1","role":"assistant","kind":"text","text":"新しい版","inHistory":true},{"clientId":"seed-${s.id}-2","deleted":true},{"clientId":"p1","role":"user","kind":"text","text":"保存待ち","inHistory":true}]}]';
    server.offline = true;
    server.offline = false;
    server.putOffline = true;
    final app = await SpaceApp(server, prefs).start();
    expect(app.texts, ['発言 ${s.id}-0', '新しい版', '保存待ち']);
    app.dispose();
  });
}
