import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

// 相談（consult）の画面：タスク選びカード → 相談モードの帯とスレッド → × で抜ける。

class _ConsultAssistant implements AssistantService {
  final List<String> calls = [];
  List<CopilotHistoryMessage> past = const [
    CopilotHistoryMessage(id: '1', fromUser: true, content: '前回の質問です'),
    CopilotHistoryMessage(id: '2', fromUser: false, content: '前回の答えです'),
  ];

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    calls.add('route:$text:$hasOpenTask');
    return text.startsWith('相談') ? const RoutedIntent(intent: 'consult') : const RoutedIntent();
  }

  @override
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async {
    calls.add('history:$taskId');
    return past;
  }

  @override
  Future<CopilotReply> copilotChat(String message,
      {required String taskId, List<Map<String, String>> history = const []}) async {
    calls.add('consult:$taskId:$message:${history.length}');
    return CopilotReply(content: '「$message」への相談の返事');
  }

  @override
  Future<CopilotReply> chat(String message,
      {List<Map<String, String>> history = const []}) async {
    calls.add('chat:$message');
    return const CopilotReply(content: '一般の返事');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _IdleDictation implements DictationService {
  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async =>
      null;

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {}
}

Task _t(String id, String title, String status, int day) => Task(
      id: id,
      title: title,
      status: status,
      priority: 'medium',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, day),
    );

final _tasks = [
  _t('3', '古いタスク', 'done', 2),
  _t('7', 'ログインのバグを直す', 'in-progress', 8),
  _t('9', '設計書を書く', 'todo', 5),
];

void main() {
  late _ConsultAssistant assistant;

  setUp(() => assistant = _ConsultAssistant());

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        dictationServiceProvider.overrideWithValue(_IdleDictation()),
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

  testWidgets('タスク選びカード：最近更新された順の一覧。デスクトップ版の案内は出ない', (tester) async {
    await pumpScreen(tester);
    await send(tester, '相談：どこから調べればいい？');

    expect(find.text('どのタスクについて相談しますか'), findsOneWidget);
    expect(find.textContaining('デスクトップ版'), findsNothing);
    final y = [
      for (final title in ['ログインのバグを直す', '設計書を書く', '古いタスク'])
        tester.getTopLeft(find.text(title)).dy,
    ];
    expect(y[0] < y[1] && y[1] < y[2], isTrue);
    expect(find.text('進行中'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-consult-band')), findsNothing);
    expect(assistant.calls, ['route:相談：どこから調べればいい？:false']);
  });

  testWidgets('選ぶと帯が出て、履歴と返信がスレッドに並ぶ。以降は相談として送り、× で抜ける', (tester) async {
    await pumpScreen(tester);
    await send(tester, '相談：どこから調べればいい？');

    await tester.tap(find.byKey(const ValueKey('rapi-consult-task-7')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('rapi-consult-band')), findsOneWidget);
    expect(find.text('相談中'), findsOneWidget);
    expect(find.text('「ログインのバグを直す」について相談します'), findsOneWidget);
    expect(find.text('「ログインのバグを直す」のこれまでの相談（2件）'), findsOneWidget);
    expect(find.text('前回の質問です'), findsOneWidget);
    expect(find.text('前回の答えです'), findsOneWidget);
    expect(find.text('「相談：どこから調べればいい？」への相談の返事'), findsOneWidget);
    expect(find.text('どのタスクについて相談しますか'), findsNothing);
    expect(assistant.calls.sublist(1), [
      'history:7',
      'consult:7:相談：どこから調べればいい？:2',
    ]);

    // 相談モード中は振り分けを通さず、一般チャットへも送らない
    await send(tester, 'ログには何も出ていない');
    expect(assistant.calls.last, 'consult:7:ログには何も出ていない:4');
    expect(assistant.calls.where((c) => c.startsWith('route:')), hasLength(1));
    expect(assistant.calls.where((c) => c.startsWith('chat:')), isEmpty);

    await tester.tap(find.byKey(const ValueKey('rapi-consult-exit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('rapi-consult-band')), findsNothing);
    expect(find.text('「ログインのバグを直す」の相談を終えました'), findsOneWidget);

    await send(tester, 'こんにちは');
    expect(assistant.calls.sublist(assistant.calls.length - 2),
        ['route:こんにちは:false', 'chat:こんにちは']);
  });

  testWidgets('「やめる」で選ばずに閉じる', (tester) async {
    await pumpScreen(tester);
    await send(tester, '相談：どこから調べればいい？');

    await tester.tap(find.byKey(const ValueKey('rapi-consult-dismiss')));
    await tester.pumpAndSettle();

    expect(find.text('どのタスクについて相談しますか'), findsNothing);
    expect(find.text('タスクを選ばずに閉じました（この発言は送っていません）'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-consult-band')), findsNothing);
  });
}
