// 設定の「聞き間違いの学習」と、学習した読み替えの一覧画面（設計 §5・§7.4）
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/voice_learning_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/settings/voice_learning_screen.dart';
import 'package:rapitas_mobile/services/approval_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:rapitas_mobile/services/voice_learning_store.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeApprovals implements ApprovalService {
  @override
  Future<List<ApprovalRequest>> getApprovals() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTasks implements TaskService {
  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async =>
      const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeRapiChat extends RapiChatNotifier {
  @override
  Future<void> send() async {}
}

Map<String, Object> _stored(List<(VoiceTargetKind, String, String, String, int, DateTime)> entries,
        {bool? enabled}) =>
    {
      if (enabled != null) VoiceLearningEnabledNotifier.prefsKey: enabled,
      VoiceLearningStore.prefsKey: jsonEncode({
        'version': 1,
        'corrections': [
          for (final (kind, heard, id, label, count, used) in entries)
            {
              'kind': kind.name,
              'heard': heard,
              'heardText': heard,
              'targetId': id,
              'label': label,
              'count': count,
              'createdAt': used.toIso8601String(),
              'lastUsedAt': used.toIso8601String(),
            },
        ],
        'targetUsage': [],
        'commandUsage': [],
      }),
    };

void main() {
  late GoRouter router;
  late ProviderContainer container;

  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day, 12);
  final twoEntries = [
    (VoiceTargetKind.task, 'ロビン画面', '1', 'ログイン画面の修正', 3, today),
    (VoiceTargetKind.theme, 'かいはつ', '10', '開発', 1, today.subtract(const Duration(days: 1))),
  ];

  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pumpApp(WidgetTester tester, String location, {Map<String, Object> prefs = const {}}) async {
    SharedPreferences.setMockInitialValues(prefs);
    final tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: location);
    container = ProviderContainer(overrides: [
      approvalServiceProvider.overrideWithValue(_FakeApprovals()),
      taskServiceProvider.overrideWithValue(_FakeTasks()),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
      rapiChatProvider.overrideWith(() => _FakeRapiChat()),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ));
    await settle(tester);
  }

  final learningSwitch = find.byKey(const ValueKey('voice-learning-switch'));
  final listEntry = find.byKey(const ValueKey('voice-learning-list-entry'));

  group('設定の「音声操作」', () {
    testWidgets('既定はオン。切り替えると voiceLearningEnabled に保存され、起動し直しても残る', (tester) async {
      await pumpApp(tester, '/settings');
      await tester.scrollUntilVisible(listEntry, 200);
      expect(tester.widget<SwitchListTile>(learningSwitch).value, isTrue);
      expect(find.text('オン：候補から選び直した対象を、この端末だけに覚えます'), findsOneWidget);

      await tester.ensureVisible(learningSwitch);
      await settle(tester);
      await tester.tap(learningSwitch);
      await settle(tester);
      expect(container.read(voiceLearningEnabledProvider), isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(VoiceLearningEnabledNotifier.prefsKey), isFalse);

      // 次の起動では保存した値から始まる
      final next = VoiceLearningEnabledNotifier();
      await next.ready;
      expect(next.state, isFalse);
    });

    testWidgets('0件なら「まだありません」で押せない', (tester) async {
      await pumpApp(tester, '/settings');
      await tester.scrollUntilVisible(listEntry, 200);
      expect(find.descendant(of: listEntry, matching: find.text('まだありません')), findsOneWidget);
      expect(tester.widget<ListTile>(listEntry).enabled, isFalse);
    });

    testWidgets('件数を出し、押すと一覧画面を開く。オフでも保存済みの件数を出す', (tester) async {
      await pumpApp(tester, '/settings', prefs: _stored(twoEntries, enabled: false));
      await tester.scrollUntilVisible(listEntry, 200);
      expect(find.descendant(of: listEntry, matching: find.text('2件')), findsOneWidget);
      expect(find.text('オフ：覚えた読み替えを使わず、新しく覚えもしません（保存済みの2件は残っています）'), findsOneWidget);

      await tester.ensureVisible(listEntry);
      await settle(tester);
      await tester.tap(listEntry);
      await settle(tester);
      expect(find.byType(VoiceLearningScreen), findsOneWidget);
      expect(find.text('「ロビン画面」→ ログイン画面の修正'), findsOneWidget);
    });
  });

  group('学習した読み替えの一覧', () {
    final robinRow = find.byKey(const ValueKey('voice-learning-row-task-ロビン画面'));

    testWidgets('最後に使った新しい順に、対応・種別・回数・最終日を出す', (tester) async {
      await pumpApp(tester, '/settings/voice-learning', prefs: _stored(twoEntries));
      expect(find.text('「ロビン画面」→ ログイン画面の修正'), findsOneWidget);
      expect(find.textContaining('タスク・3回・最終 '), findsOneWidget);
      expect(find.textContaining('テーマ・1回・最終 '), findsOneWidget);
      final robinY = tester.getTopLeft(robinRow).dy;
      final themeY = tester.getTopLeft(find.byKey(const ValueKey('voice-learning-row-theme-かいはつ'))).dy;
      expect(robinY, lessThan(themeY), reason: '新しい順');
    });

    testWidgets('個別削除はすぐ消し、スナックバーの「元に戻す」で戻る', (tester) async {
      await pumpApp(tester, '/settings/voice-learning', prefs: _stored(twoEntries));
      await tester.tap(find.descendant(of: robinRow, matching: find.byIcon(Icons.delete_outline)));
      await settle(tester);
      expect(robinRow, findsNothing);
      expect(container.read(voiceLearningProvider), hasLength(1));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(VoiceLearningStore.prefsKey), isNot(contains('ロビン画面')));

      await tester.tap(find.text('元に戻す'));
      await settle(tester);
      expect(robinRow, findsOneWidget);
      expect(container.read(voiceLearningProvider), hasLength(2));
    });

    testWidgets('すべて消去：ダイアログでキャンセルすると残り、消去すると空になる', (tester) async {
      await pumpApp(tester, '/settings/voice-learning', prefs: _stored(twoEntries));
      final clearAll = find.byKey(const ValueKey('voice-learning-clear-all'));

      await tester.tap(clearAll);
      await settle(tester);
      expect(find.text('覚えた読み替え2件をすべて消します。元に戻せません。'), findsOneWidget);
      await tester.tap(find.text('キャンセル'));
      await settle(tester);
      expect(container.read(voiceLearningProvider), hasLength(2));

      await tester.tap(clearAll);
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('voice-learning-clear-confirm')));
      await settle(tester);
      expect(container.read(voiceLearningProvider), isEmpty);
      expect(find.text('覚えた読み替えはありません'), findsOneWidget);
      expect(tester.widget<TextButton>(clearAll).onPressed, isNull, reason: '空なら押せない');
    });
  });
}
