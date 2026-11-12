import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_spaces_provider.dart';
import 'package:rapitas_mobile/services/rapi_chat_space_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_space_fakes.dart';
import '../support/rapi_space_harness.dart';

// 会話スペースの切り替え・読み取り専用・相談・削除（設計 nav39 受け入れ条件 3・3a・4・5、11.2「切り替え」）。

const _last = 'rapiLastSpaceId.v1:http://localhost:3001';

/// 記録のカードを1件ずつ持つスペース（処理の途中の段階や確定前の段階のまま保存されたもの）
FakeSpace _seedCards(FakeSpaceServer server) {
  final s = server.seed(title: '記録');
  final cards = <RapiMessage>[
    RapiMessage(
        id: 1,
        role: RapiRole.assistant,
        roadmap: RapiRoadmapCard(
            text: '計画',
            draft: const RoadmapDraft(
                goal: '目標',
                themeChoice: RoadmapPlacement(kind: 'none'),
                projectChoice: RoadmapPlacement(kind: 'none'),
                steps: [RoadmapStep(title: '手順', acceptanceCriteria: ['条件'])]))),
    const RapiMessage(
        id: 2,
        role: RapiRole.assistant,
        tidy: RapiTidyCard(
            text: '片付け',
            phase: RapiTidyPhase.listing,
            items: [TidyItem(id: '1', title: 'a', status: 'done')],
            chosen: {'1'})),
    const RapiMessage(
        id: 3,
        role: RapiRole.assistant,
        change: RapiChangeCard(
            proposal: ChangeProposal(taskId: '5', title: 't', changes: TaskChanges({'priority': 'high'})),
            phase: RapiChangePhase.applying)),
    const RapiMessage(
        id: 4,
        role: RapiRole.assistant,
        companion: RapiCompanionCard(
            proposal: RapiCompanionProposal(action: RapiCompanionAction.start, taskId: '5', title: 't'))),
    RapiMessage(
        id: 5,
        role: RapiRole.assistant,
        tidy: RapiTidyCard(
            text: '戻す',
            phase: RapiTidyPhase.done,
            items: [for (var i = 0; i < 30; i++) TidyItem(id: '$i', title: 't$i', status: 'done')],
            run: const TaskDeleteRun(results: [TaskDeletion(taskId: '1', outcome: 'deleted', trashId: 9)]),
            restores: const {9: RapiTidyRestore.restoring})),
  ];
  for (final m in cards) {
    server.addRow(s, encodeRapiMessage(m, clientId: 'card${m.id}')!);
  }
  return s;
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

  test('受け入れ3：2つのスペースを行き来しても発言が混ざらない', () async {
    final app = await SpaceApp(server, prefs).start();
    await app.say('Aの話');
    final a = server.spaces.values.single;
    expect(app.spaces.newConversation(), RapiSwitchOutcome.switched);
    await app.say('Bの話');
    final b = server.spaces.values.firstWhere((s) => s.id != a.id);
    expect(rowTexts(a), ['Aの話', 'はい（Aの話）']);
    expect(rowTexts(b), ['Bの話', 'はい（Bの話）']);

    await app.spaces.openSpace(summary(a));
    await app.settle();
    expect(app.texts, ['Aの話', 'はい（Aの話）']);
    await app.say('Aの続き');
    expect(app.assistant.histories.last.map((t) => t['content']), ['Aの話', 'はい（Aの話）']);
    expect(rowTexts(b), ['Bの話', 'はい（Bの話）'], reason: '切り替えで消えた行は削除として送らない');
    expect(prefs[_last], 'space:${a.id}');
    app.dispose();
  });

  test('応答待ちの間は、開く・新規・削除のどれもできない', () async {
    final other = server.seed(messages: 2);
    final app = await SpaceApp(server, prefs).start();
    await app.say('最初');
    final gate = Completer<void>();
    app.assistant.chatGate = gate;
    app.chat.setInput('待つ');
    final sending = app.chat.send();
    await Future<void>.delayed(Duration.zero);
    expect(app.chatState.sending, isTrue);
    expect(await app.spaces.openSpace(summary(other)), RapiSwitchOutcome.busy);
    expect(app.spaces.newConversation(), RapiSwitchOutcome.busy);
    expect(await app.spaces.deleteSpace(app.spacesState.spaceId!), RapiSwitchOutcome.busy);
    gate.complete();
    await sending;
    expect(await app.spaces.openSpace(summary(other)), RapiSwitchOutcome.switched);
    app.dispose();
  });

  test('処理の途中の段階で保存された記録を読み込んでも、開く・新規・削除ができる', () async {
    final s = _seedCards(server);
    final other = server.seed(messages: 1);
    prefs[_last] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    expect(app.chatState.messages.where((m) => m.change != null).single.change!.phase,
        RapiChangePhase.applying);
    expect(app.chat.busyForSwitch, isFalse);
    expect(await app.spaces.openSpace(summary(other)), RapiSwitchOutcome.switched);
    app.dispose();
  });

  test('受け入れ3a：記録のカードは provider のメソッドを直接呼んでも変わらず、要求も出ない', () async {
    final s = _seedCards(server);
    prefs[_last] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    int idOf(bool Function(RapiMessage) f) => app.chatState.messages.firstWhere(f).id;
    final roadmap = idOf((m) => m.roadmap != null);
    final tidy = idOf((m) => m.tidy?.phase == RapiTidyPhase.listing);
    final change = idOf((m) => m.change != null);
    final companion = idOf((m) => m.companion != null);
    final done = idOf((m) => m.tidy?.phase == RapiTidyPhase.done);
    final before = app.chatState.messages;
    final puts = server.puts.length;

    app.chat
      ..chooseRoadmapAnswer(roadmap, 0, 'x')
      ..toggleRoadmapCriterion(roadmap, 0, 0)
      ..editRoadmapCriterion(roadmap, 0, 0, '直した')
      ..cancelRoadmap(roadmap)
      ..setTidyHow(tidy, RapiTidyHow.text)
      ..setTidyTheme(tidy, '3')
      ..toggleTidyStatus(tidy, 'done')
      ..setTidyDays(tidy, 30)
      ..toggleTidyItem(tidy, '1')
      ..setTidyAll(tidy, false)
      ..backToTidySetup(tidy)
      ..cancelTidy(tidy)
      ..cancelChange(change)
      ..cancelCompanion(companion);
    await app.chat.refineRoadmap(roadmap);
    await app.chat.commitRoadmap(roadmap);
    await app.chat.searchTidy(tidy);
    await app.chat.deleteTidy(tidy);
    await app.chat.restoreTidy(done, 9);
    await app.chat.restoreAllTidy(done);
    await app.chat.applyChange(change);
    await app.chat.revertChange(change);
    await app.chat.applyCompanion(companion);
    await app.settle();

    expect(identical(app.chatState.messages, before), isTrue);
    expect(app.assistant.writes, isEmpty);

    // 表示だけの「すべて見る」は効くが、保存し直さない
    app.chat.expandTidy(done);
    await app.settle();
    expect(app.chatState.messages.firstWhere((m) => m.id == done).tidy!.expanded, isTrue);
    expect(server.puts.length, puts);
    app.dispose();
  });

  test('受け入れ5：相談スレッドの発言は保存されず、相談へ移した発言は deleted になる', () async {
    final app = await SpaceApp(server, prefs).start();
    await app.say('ふつうの話');
    await app.say('相談したい');
    final space = server.spaces.values.single;
    expect(rowTexts(space), contains('相談したい'));
    final picker = app.chatState.messages.firstWhere((m) => m.consultPicker != null);
    await app.chat.chooseConsultTask(picker.id, const RapiConsultTask(id: '5', title: '資料'));
    await app.settle();
    app.chat.setInput('相談の続き');
    await app.chat.send();
    await app.settle();
    expect(app.chatState.consultTask, isNotNull);
    expect(rowTexts(space).where((t) => t.contains('相談')), ['タスクについての相談として受け取りました']);

    // 相談中に切り替えると相談を抜ける（帯の「相談を終えました」は出さない）
    app.spaces.newConversation();
    expect(app.chatState.consultTask, isNull);
    expect(app.texts.where((t) => t.contains('相談を終えました')), isEmpty);
    app.dispose();
  });

  test('切り替えでは下書きと見守りを捨て、入力欄とショートカットの依頼は残す。読み込み中の案内も残る', () async {
    final other = server.seed(messages: 2);
    final app = await SpaceApp(server, prefs).start();
    await app.say('最初');
    app.chat.setInput('書きかけ');
    server.loadGate = Completer<void>();
    await app.spaces.openSpace(summary(other));
    expect(app.spacesState.loading, isTrue);
    expect(app.spacesState.blocksSend, isTrue);
    app.chat.notice('読み込み中に届いた案内');
    server.loadGate!.complete();
    await app.settle();
    expect(app.chatState.input, '書きかけ');
    expect(app.texts, ['発言 ${other.id}-0', '発言 ${other.id}-1', '読み込み中に届いた案内']);
    expect(app.chatState.draft, isNull);
    expect(app.chatState.surveyVisible, isFalse);
    app.dispose();
  });

  test('古い読み込みの結果は捨てる（世代番号）', () async {
    final a = server.seed(messages: 1);
    final b = server.seed(messages: 1);
    final app = await SpaceApp(server, prefs).start();
    server.loadGate = Completer<void>();
    await app.spaces.openSpace(summary(a));
    await app.spaces.openSpace(summary(b));
    server.loadGate!.complete();
    await app.settle();
    expect(app.texts, ['発言 ${b.id}-0']);
    app.dispose();
  });

  test('受け入れ4・削除：いま開いているスペースを消すと新しい会話へ。最後の1件を消すと一覧は空', () async {
    final app = await SpaceApp(server, prefs).start();
    await app.say('消す会話');
    final id = app.spacesState.spaceId!;
    expect(await app.spaces.deleteSpace(id), RapiSwitchOutcome.switched);
    expect(app.spacesState.isNew, isTrue);
    expect(app.texts, isEmpty);
    expect(await app.spaces.listSpaces(), isEmpty);
    expect(server.spaces, isEmpty);
    // 404（もう無い）も成功として扱う
    await app.spaces.deleteSpace(id);
    app.dispose();
  });

  test('新しい会話で「＋ 新しい会話」を押しても何もしない（空のスペースを増やさない）', () async {
    final app = await SpaceApp(server, prefs).start();
    expect(app.spaces.newConversation(), RapiSwitchOutcome.unchanged);
    expect(server.calls.where((c) => c.startsWith('POST')), isEmpty);
    app.dispose();
  });
}
