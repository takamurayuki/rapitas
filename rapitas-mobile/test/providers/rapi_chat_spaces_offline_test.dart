import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/rapi_chat_spaces_provider.dart';
import 'package:rapitas_mobile/services/rapi_chat_space_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_space_fakes.dart';
import '../support/rapi_space_harness.dart';

// 機内モードと未作成スペース（設計 nav39 受け入れ条件 6・6b・6c、11.2「未作成スペース」）。

const _last = 'rapiLastSpaceId.v1:http://localhost:3001';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeSpaceServer server;
  late Map<String, String> prefs;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    server = FakeSpaceServer();
    prefs = {};
  });

  test('受け入れ6（既存スペース）：機内モードの発言と失敗の案内は、戻ると1回だけ保存される', () async {
    final s = server.seed(messages: 2);
    prefs[_last] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    server.offline = true;
    app.assistant.offline = true;
    await app.say('圏外の発言');
    await app.settle();
    expect(rowTexts(s), hasLength(2));
    server.offline = false;
    await app.settle();
    await app.settle();
    expect(s.rows.skip(2).map(rowShape), ['user:圏外の発言:false', 'system:送信に失敗しました:false']);
    app.dispose();
  });

  test('受け入れ6（未作成スペース）：機内モードで話し、終了・起動しても開き、戻るとスペースが1つだけできる', () async {
    server.offline = true;
    final a = await SpaceApp(server, prefs).start();
    a.assistant.offline = true;
    await a.say('はじめての発言');
    expect(prefs[_last], startsWith('local:'));
    a.dispose();

    final b = await SpaceApp(server, prefs).start();
    expect(b.spacesState.isNew, isTrue);
    expect(b.texts, ['はじめての発言', '送信に失敗しました']);
    expect(b.chatState.messages.where((m) => !m.localOnly).every((m) => m.archived), isTrue);
    b.assistant.offline = false;
    server.offline = false;
    await b.say('つながった');
    await b.settle();
    expect(server.spaces, hasLength(1));
    final space = server.spaces.values.single;
    expect(rowTexts(space), ['はじめての発言', '送信に失敗しました', 'つながった', 'はい（つながった）']);
    expect(b.spacesState.spaceId, space.id);
    expect(prefs[_last], 'space:${space.id}');
    expect((await b.spaces.listSpaces()).map((s) => s.id), [space.id]);
    b.dispose();
  });

  test('受け入れ6b：未作成の A から B へ移って終えると、裏で A ができても次の起動は B', () async {
    final bSpace = server.seed(title: 'B', messages: 1);
    server.offline = true;
    final app = await SpaceApp(server, prefs).start();
    app.assistant.offline = true;
    await app.say('Aの発言');
    // 圏外のまま B へ移る（B の読み込みも失敗するが、移ること自体はできる）
    expect(await app.spaces.openSpace(RapiSpaceSummary(id: bSpace.id, title: 'B')),
        RapiSwitchOutcome.switchedLeavingUnsaved);
    server.offline = false;
    await app.settle();
    await app.settle();
    expect(prefs[_last], 'space:${bSpace.id}');
    expect(app.spacesState.spaceId, bSpace.id);
    final aSpace = server.spaces.values.firstWhere((s) => s.id != bSpace.id);
    expect(rowTexts(aSpace), ['Aの発言', '送信に失敗しました']);
    app.dispose();

    final again = await SpaceApp(server, prefs).start();
    expect(again.spacesState.spaceId, bSpace.id);
    await again.spaces.openSpace(RapiSpaceSummary(id: aSpace.id));
    await again.settle();
    expect(again.texts, ['Aの発言', '送信に失敗しました']);
    again.dispose();
  });

  test('A から「＋ 新しい会話」へ移った場合も、A の作成で最後のスペースは書き換わらない', () async {
    server.offline = true;
    final app = await SpaceApp(server, prefs).start();
    app.assistant.offline = true;
    await app.say('Aの発言');
    expect(app.spaces.newConversation(), RapiSwitchOutcome.switchedLeavingUnsaved);
    final current = prefs[_last];
    server.offline = false;
    await app.settle();
    expect(server.spaces, hasLength(1));
    expect(prefs[_last], current);
    expect(app.spacesState.isNew, isTrue);
    app.dispose();
  });

  test('受け入れ6c：作成だけが通り PUT が通らないまま話して終え、起動時の読み込みも失敗しても、全部並んで続けられる',
      () async {
    server.putOffline = true;
    final a = await SpaceApp(server, prefs).start();
    await a.say('作成前');
    final id = a.spacesState.spaceId!;
    expect(prefs[_last], 'space:$id', reason: '開いている未作成の会話は、作成が通ると spaceId になる');
    await a.say('作成後');
    a.dispose();

    server.loadOffline = true;
    final b = await SpaceApp(server, prefs).start();
    expect(b.spacesState.spaceId, id);
    expect(b.spacesState.loadFailed, isTrue);
    expect(b.spacesState.loadFailedKeepGoing, isTrue);
    expect(b.spacesState.blocksSend, isFalse);
    expect(b.texts, ['作成前', 'はい（作成前）', '作成後', 'はい（作成後）']);
    await b.say('起動後');
    expect(b.spaces.queue!.bucketForSpace(id)!.items.map((i) => i.text), contains('起動後'));

    // 読み込みが失敗したまま追記してから「もう一度」が通っても、追記した分は消えない
    server.loadOffline = false;
    await b.spaces.retry();
    await b.settle();
    expect(b.spacesState.loadFailed, isFalse);
    expect(b.texts, ['作成前', 'はい（作成前）', '作成後', 'はい（作成後）', '起動後', 'はい（起動後）']);

    server.putOffline = false;
    await b.settle();
    expect(server.spaces, hasLength(1));
    expect(rowTexts(server.spaces[id]!), b.texts);
    expect(server.calls.where((c) => c.startsWith('POST')), hasLength(1));
    b.dispose();
  });

  test('6.3 の例外はシートから開いたときも同じ。originLocalKey の無いスペースの失敗は「新しい会話を始める」も出す',
      () async {
    final plain = server.seed(messages: 1);
    server.putOffline = true;
    final app = await SpaceApp(server, prefs).start();
    await app.say('作成だけ');
    final created = app.spacesState.spaceId!;
    app.spaces.newConversation();
    server.loadOffline = true;
    await app.spaces.openSpace(RapiSpaceSummary(id: created));
    await app.settle();
    expect(app.spacesState.loadFailedKeepGoing, isTrue);
    expect(app.texts, ['作成だけ', 'はい（作成だけ）']);

    await app.spaces.openSpace(RapiSpaceSummary(id: plain.id));
    await app.settle();
    expect(app.spacesState.loadFailed, isTrue);
    expect(app.spacesState.loadFailedKeepGoing, isFalse);
    expect(app.spacesState.blocksSend, isTrue);
    expect(app.texts, isEmpty);
    app.dispose();
  });

  test('書き換えの途中で落ちた（宛先は spaceId、最後のスペースは localKey のまま）状態から起動すると直る', () async {
    final s = server.seed();
    prefs[_last] = 'local:abc';
    prefs['rapiChatPendingSaves.v1:http://localhost:3001'] =
        '[{"spaceId":${s.id},"originLocalKey":"local:abc","items":[{"clientId":"x","role":"user","kind":"text","text":"落ちる前","inHistory":true}]}]';
    final app = await SpaceApp(server, prefs).start();
    expect(app.spacesState.spaceId, s.id);
    expect(prefs[_last], 'space:${s.id}');
    expect(app.texts, ['落ちる前']);
    app.dispose();
  });

  test('保存待ちは接続先ごとに分かれる', () async {
    server.offline = true;
    final app = await SpaceApp(server, prefs).start();
    app.assistant.offline = true;
    await app.say('前の接続先');
    app.dispose();
    expect(prefs.keys.where((k) => k.startsWith('rapiChatPendingSaves.v1:')),
        ['rapiChatPendingSaves.v1:http://localhost:3001']);
  });
}
