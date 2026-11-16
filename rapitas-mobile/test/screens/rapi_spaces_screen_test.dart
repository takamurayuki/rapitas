import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_space_fakes.dart';
import '../support/rapi_space_screen.dart';

// ラピの画面の会話スペース（設計 nav39 8章・11.2「履歴のカード」「読み取り専用の範囲」）。

const _last = 'rapiLastSpaceId.v1:http://localhost:3001';

void _addCard(FakeSpaceServer server, FakeSpace s, RapiMessage m) =>
    server.addRow(s, encodeRapiMessage(m, clientId: 'card${m.id}')!);

const _question = RoadmapDraft(
  goal: '英検2級',
  themeChoice: RoadmapPlacement(kind: 'none'),
  projectChoice: RoadmapPlacement(kind: 'none'),
  questions: [RoadmapQuestion(question: '1日の時間は？', options: ['30分', '1時間'])],
  steps: [RoadmapStep(title: '過去問', acceptanceCriteria: ['採点まで'])],
);

void main() {
  late FakeSpaceServer server;
  late Map<String, String> prefs;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    server = FakeSpaceServer();
    prefs = {};
  });

  testWidgets('タイトルにスペース名と ▾ を出し、タップで一覧のシートが開く', (tester) async {
    final s = server.seed(title: '請求書の締め切りを確認', messages: 2);
    server.seed(title: 'ほかの会話');
    prefs[_last] = 'space:${s.id}';
    await pumpSpaceScreen(tester, server, prefs);
    expect(find.text('請求書の締め切りを確認'), findsOneWidget);
    expect(find.text('ラピ'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('rapi-space-title')));
    await tester.pumpAndSettle();
    expect(find.text('会話'), findsOneWidget);
    expect(find.text('新しい会話'), findsOneWidget);
    expect(find.text('ほかの会話'), findsOneWidget);
    final current = tester.widget<ListTile>(
        find.descendant(of: find.byKey(ValueKey('rapi-space-row-${s.id}')), matching: find.byType(ListTile)));
    expect(current.selected, isTrue);
  });

  testWidgets('シートの行を横スワイプ → 確認（Q1 の文）→ 削除で、一覧からもサーバーからも消える', (tester) async {
    final s = server.seed(title: '消す会話', messages: 1);
    final app = await pumpSpaceScreen(tester, server, prefs);
    await tester.tap(find.byKey(const ValueKey('rapi-space-title')));
    await tester.pumpAndSettle();
    await tester.drag(find.byKey(ValueKey('rapi-space-row-${s.id}')), const Offset(-500, 0));
    await tester.pumpAndSettle();
    expect(find.textContaining('作ったタスクや操作の記録は消えません'), findsOneWidget);
    await tester.tap(find.text('削除'));
    await tester.pumpAndSettle();
    expect(find.text('消す会話'), findsNothing);
    expect(server.spaces, isEmpty);
    expect(app.spacesState.isNew, isTrue);
  });

  testWidgets('読み込み中は「読み込み中…」を出し、送信できない', (tester) async {
    final s = server.seed(title: '重い会話', messages: 1);
    prefs[_last] = 'space:${s.id}';
    server.loadGate = Completer<void>();
    final app = await pumpSpaceScreen(tester, server, prefs, startFirst: false);
    final starting = app.spaces.start();
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    expect(app.spacesState.loading, isTrue);
    expect(find.text('読み込み中…'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '送りたい');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pump();
    expect(app.assistant.histories, isEmpty);
    server.loadGate!.complete();
    await pumpUntil(tester, starting);
    expect(find.text('読み込み中…'), findsNothing);
    expect(find.text('発言 ${s.id}-0'), findsOneWidget);
  });

  testWidgets('記録の計画カード：ボタン列が無く、質問の選択も効かず、確定前の注記が出る', (tester) async {
    final s = server.seed(title: '記録');
    _addCard(server, s,
        RapiMessage(id: 1, role: RapiRole.assistant, roadmap: RapiRoadmapCard.fromDraft('英検', _question)));
    prefs[_last] = 'space:${s.id}';
    final app = await pumpSpaceScreen(tester, server, prefs);
    expect(find.byKey(const ValueKey('rapi-roadmap-refine')), findsNothing);
    expect(find.text('やめる'), findsNothing);
    expect(find.text('このときは確定していません'), findsOneWidget);
    expect(find.textContaining('記録 ·'), findsOneWidget);
    final before = app.chatState.messages;
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-q0-30分')));
    await tester.pump();
    expect(identical(app.chatState.messages, before), isTrue);
    expect(app.assistant.writes, isEmpty);
  });

  testWidgets('記録の片付けカード：削除ボタンが無く、チェックも効かない。「残りも表示」とタスク一覧は効く', (tester) async {
    final s = server.seed(title: '記録');
    _addCard(
        server,
        s,
        RapiMessage(
          id: 1,
          role: RapiRole.assistant,
          tidy: RapiTidyCard(
            text: '片付け',
            phase: RapiTidyPhase.listing,
            items: [for (var i = 0; i < 25; i++) TidyItem(id: '$i', title: '候補$i', status: 'done')],
            chosen: const {'0'},
          ),
        ));
    prefs[_last] = 'space:${s.id}';
    final app = await pumpSpaceScreen(tester, server, prefs);
    expect(find.byKey(const ValueKey('rapi-tidy-delete')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-item-1')));
    await tester.pump();
    expect(app.chatState.messages.firstWhere((m) => m.tidy != null).tidy!.chosen, {'0'});
    await tester.ensureVisible(find.byKey(const ValueKey('rapi-tidy-expand')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-expand')));
    await tester.pump();
    expect(app.chatState.messages.firstWhere((m) => m.tidy != null).tidy!.expanded, isTrue);
  });

  testWidgets('処理の途中で保存された変更カードは「確かめられませんでした」と出し、適用ボタンは無い', (tester) async {
    final s = server.seed(title: '記録');
    _addCard(
        server,
        s,
        const RapiMessage(
          id: 1,
          role: RapiRole.assistant,
          change: RapiChangeCard(
            proposal: ChangeProposal(taskId: '5', title: '請求書の送付', changes: TaskChanges({'priority': 'high'})),
            phase: RapiChangePhase.applying,
          ),
        ));
    prefs[_last] = 'space:${s.id}';
    await pumpSpaceScreen(tester, server, prefs);
    expect(find.text('結果を確かめられませんでした。タスクを開いて確認してください'), findsOneWidget);
    expect(find.text('適用する'), findsNothing);
    expect(find.text('変更しています…'), findsNothing);
  });

  testWidgets('記録の完了条件カード：「取り消す」が無く「タスクを開く」だけ。確定待ちの記録は「確かめられませんでした」', (tester) async {
    final s = server.seed(title: '記録');
    const base = ['ログインできる', 'エラーが出る'];
    final start = RapiCriteriaCard.start(taskId: '7', title: 'ログインのバグを直す', criteria: base);
    _addCard(
        server,
        s,
        RapiMessage(
            id: 1,
            role: RapiRole.assistant,
            criteria: start.copyWith(
                phase: RapiCriteriaPhase.applied,
                result: const RapiCriteriaChangeResult(actionId: 31, before: base, after: ['ログインできる']))));
    _addCard(server, s,
        RapiMessage(id: 2, role: RapiRole.assistant, criteria: start.copyWith(phase: RapiCriteriaPhase.applying)));
    prefs[_last] = 'space:${s.id}';
    final app = await pumpSpaceScreen(tester, server, prefs);
    expect(find.text('完了条件を変えました'), findsOneWidget);
    expect(find.text('変更できたか確かめられませんでした'), findsOneWidget);
    expect(find.textContaining('記録 ·'), findsNWidgets(2));
    expect(find.byKey(const ValueKey('rapi-criteria-revert')), findsNothing);
    expect(find.byKey(const ValueKey('rapi-criteria-apply')), findsNothing);
    expect(find.text('変更しています…'), findsNothing);
    expect(find.byKey(const ValueKey('rapi-criteria-open')), findsNWidgets(2));
    await tester.tap(find.byKey(const ValueKey('rapi-criteria-open')).first);
    await tester.pumpAndSettle();
    expect(find.text('タスクの画面'), findsOneWidget);
    expect(app.assistant.writes, isEmpty);
  });

  testWidgets('新しい形の記録はカードの位置に「表示できません」を出す（例外にならない）', (tester) async {
    final s = server.seed(title: '記録');
    server.addRow(
        s,
        const SavedMessage(
            clientId: 'x', role: 'assistant', kind: 'poll', text: '本文', payload: '{"v":2,"kind":"poll","poll":{}}'));
    prefs[_last] = 'space:${s.id}';
    await pumpSpaceScreen(tester, server, prefs);
    expect(find.text('この記録は新しいアプリで保存されたため表示できません'), findsOneWidget);
    expect(find.text('本文'), findsOneWidget);
  });
}
