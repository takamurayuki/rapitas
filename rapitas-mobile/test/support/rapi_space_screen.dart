import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

import 'rapi_space_fakes.dart';
import 'rapi_space_harness.dart';

// 会話スペースのついたラピの画面を、偽のサーバーで描く（nav39 のウィジェットテストとキャプチャ用）。

class IdleDictation implements DictationService {
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

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// [future] が終わるまで pump を回す（provider の future を runAsync の中で待たない。AGENTS.md の教訓）
Future<void> pumpUntil(WidgetTester tester, Future<void> future) async {
  var done = false;
  future.whenComplete(() => done = true);
  for (var i = 0; i < 100 && !done; i++) {
    await tester.pump(const Duration(milliseconds: 10));
  }
}

/// 起動時の解決を済ませたラピの画面を出す
Future<SpaceApp> pumpSpaceScreen(
  WidgetTester tester,
  FakeSpaceServer server,
  Map<String, String> prefs, {
  ThemeMode themeMode = ThemeMode.light,
  bool startFirst = true,
  ThemeData Function(ThemeData)? themeTweak,
  Key? boundaryKey,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final app = SpaceApp(server, prefs, extra: [
    dictationServiceProvider.overrideWithValue(IdleDictation()),
    themeListProvider.overrideWith((ref) async => <TaskTheme>[]),
    taskListProvider.overrideWith((ref, filter) async => <Task>[]),
    taskDetailProvider.overrideWith((ref, id) async => throw StateError('unused')),
  ]);
  addTearDown(app.dispose);
  if (startFirst) await pumpUntil(tester, app.spaces.start());
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (context, state) => const RapiScreen()),
    GoRoute(path: '/tasks', builder: (context, state) => const Scaffold(body: Text('タスク一覧の画面'))),
    GoRoute(path: '/tasks/:id', builder: (context, state) => const Scaffold(body: Text('タスクの画面'))),
  ]);
  final tweak = themeTweak ?? ((ThemeData t) => t);
  await tester.pumpWidget(RepaintBoundary(
    key: boundaryKey,
    child: UncontrolledProviderScope(
      container: app.c,
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        routerConfig: router,
        theme: tweak(AppTheme.lightTheme),
        darkTheme: tweak(AppTheme.darkTheme),
        themeMode: themeMode,
      ),
    ),
  ));
  await tester.pump();
  return app;
}
