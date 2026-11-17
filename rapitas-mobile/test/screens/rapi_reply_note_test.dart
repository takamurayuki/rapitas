import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_reply_note_button.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

import '../support/note_fakes.dart';

// ラピの文章の返答カードの「ノートに保存」：一般の会話は紐付けなし、相談はそのタスクへ紐付け、
// 保存後は「保存済み」で再送しない、保存の失敗は成功と出さない。

class _Assistant implements AssistantService {
  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      text.startsWith('相談') ? const RoutedIntent(intent: 'consult') : const RoutedIntent();

  @override
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async => const [];

  @override
  Future<CopilotReply> copilotChat(String message,
          {required String taskId, List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: '相談の答えです');

  @override
  Future<CopilotReply> chat(String message,
          {List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: 'まず **ログ** を見ます。');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// 画面より十分高いユーザーの発言（ボタンの無い行）。その中ほどまでスクロールすると、
// 前後どちらの返答の行も作り直し範囲（cacheExtent）の外に出て、ボタンがすべて破棄される
final _longQuestion = [for (var i = 1; i <= 200; i++) '長い質問の$i行目'].join('\n');

final _tasks = [
  Task(
    id: '7',
    title: 'ログインのバグを直す',
    status: 'in-progress',
    priority: 'medium',
    createdAt: DateTime(2026, 11, 1),
    updatedAt: DateTime(2026, 11, 8),
  ),
];

void main() {
  late FakeNoteService notes;

  setUp(() => notes = FakeNoteService());

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        assistantServiceProvider.overrideWithValue(_Assistant()),
        noteServiceProvider.overrideWithValue(notes),
        taskListProvider.overrideWith((ref, filter) async => _tasks),
      ],
      child: const MaterialApp(home: RapiScreen()),
    ));
    await tester.pump();
  }

  Future<void> send(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField), text);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  Future<void> tapSave(WidgetTester tester) async {
    final button = find.text('ノートに保存').last;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  testWidgets('一般の会話：質問をタイトルに保存し、紐付けない。保存後は保存済みで再送しない', (tester) async {
    await pumpScreen(tester);
    // 挨拶（端末だけの行）には付けない
    expect(find.text('ノートに保存'), findsNothing);

    await send(tester, 'ログはどこを見ればいい？');
    expect(find.text('ノートに保存'), findsOneWidget);
    await tapSave(tester);

    expect(notes.calls, hasLength(1));
    expect(notes.calls.single, endsWith(':ログはどこを見ればいい？:## 質問\n\nログはどこを見ればいい？\n\n## ラピの回答\n\nまず **ログ** を見ます。\n'));
    expect(find.text(rapiNoteSavedMessage), findsOneWidget);
    expect(find.text('保存済み'), findsOneWidget);
    expect(find.text('ノートに保存'), findsNothing);

    await tester.tap(find.text('保存済み'));
    await tester.pumpAndSettle();
    expect(notes.calls, hasLength(1));
  });

  testWidgets('相談：選んだタスクへ紐付ける', (tester) async {
    await pumpScreen(tester);
    await send(tester, '相談：どこから調べればいい？');
    await tester.tap(find.byKey(const ValueKey('rapi-consult-task-7')));
    await tester.pumpAndSettle();

    await tapSave(tester);
    expect(notes.calls, hasLength(2));
    expect(notes.calls[0], contains(':相談：どこから調べればいい？:'));
    expect(notes.calls[1], matches(RegExp(r'^link:\d+:7:null$')));
    expect(find.text(rapiNoteSavedMessage), findsOneWidget);
  });

  testWidgets('紐付けだけ失敗したら、そう伝えて保存済みにする', (tester) async {
    notes.failLink = true;
    await pumpScreen(tester);
    await send(tester, '相談：どこから調べればいい？');
    await tester.tap(find.byKey(const ValueKey('rapi-consult-task-7')));
    await tester.pumpAndSettle();

    await tapSave(tester);
    expect(find.text(rapiNoteLinkFailedMessage), findsOneWidget);
    expect(find.text('保存済み'), findsOneWidget);
  });

  testWidgets('保存が失敗したら成功と出さず、もう一度押せる', (tester) async {
    notes.failSave = true;
    await pumpScreen(tester);
    await send(tester, 'ログはどこを見ればいい？');
    await tapSave(tester);

    expect(find.text(rapiNoteFailedMessage), findsOneWidget);
    expect(find.text(rapiNoteSavedMessage), findsNothing);
    expect(find.text('保存済み'), findsNothing);
    expect(find.text('ノートに保存'), findsOneWidget);
  });

  testWidgets('保存済みはスクロールで全ボタンが画面外に出て戻っても消えず、再送しない', (tester) async {
    await pumpScreen(tester);
    await send(tester, 'ログはどこを見ればいい？');
    await tapSave(tester);
    expect(notes.calls, hasLength(1));
    // スナックバーを消してから続ける（表示中の部品が残らないように）
    await tester.pump(const Duration(seconds: 10));
    await tester.pumpAndSettle();

    await send(tester, _longQuestion);
    // 長い発言の中ほどまで戻す：最初の返答のボタンも、次の返答のボタンも作られていない状態にする
    final position = tester.state<ScrollableState>(find.byType(Scrollable).first).position;
    position.jumpTo(position.maxScrollExtent / 2);
    await tester.pumpAndSettle();
    expect(find.text('保存済み', skipOffstage: false), findsNothing);
    expect(find.text('ノートに保存', skipOffstage: false), findsNothing);

    position.jumpTo(0);
    await tester.pumpAndSettle();
    expect(find.text('ノートに保存'), findsNothing);
    expect(find.text('保存済み'), findsOneWidget);
    await tester.tap(find.text('保存済み'));
    await tester.pumpAndSettle();
    expect(notes.calls, hasLength(1));
  });
}
