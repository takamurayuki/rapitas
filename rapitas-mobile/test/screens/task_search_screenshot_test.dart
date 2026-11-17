/// nav72 captures with DUMMY data for visual review (390pt wide, real Noto
/// CJK fonts) of the tasks screen search mode, shaped like the executions
/// screen search mode: (1) words typed and the visible list narrowed in place
/// with the applied-filter chips still shown, (2) search mode with empty words
/// (the list as is), (3) no task matches (the empty message in the list area).
///
/// Set TASK_SEARCH_SCREENSHOT_DIR to write them; CI leaves it unset, so the
/// test is skipped there.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/task_list/task_list_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'task_filter_selection_test.dart' show FakeTaskList, sampleTaskThemes;

Task _task(String id, String title, {String status = 'todo', String priority = 'medium', String? description}) =>
    Task(
      id: id,
      title: title,
      description: description,
      status: status,
      priority: priority,
      themeId: '11', // ☆ の「スマホアプリ」（初期選択のテーマ）
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

final _tasks = [
  _task('1', '【ダミー】ログイン画面のエラー表示', priority: 'high'),
  _task('2', '【ダミー】ホーム画面の不具合', description: 'ログイン後に白くなる'),
  _task('3', '【ダミー】通知設定の整理', priority: 'low'),
  _task('4', '【ダミー】検索アイコンの位置', status: 'done'),
  _task('5', '【ダミー】設定画面の文言', priority: 'high'),
];

/// sampleTaskThemes に付いているカテゴリ（重複なし）
List<TaskCategory> _categories() {
  final byId = <String, TaskCategory>{};
  for (final theme in sampleTaskThemes) {
    final category = theme.category;
    if (category != null) byId[category.id] = category;
  }
  return byId.values.toList();
}

void main() {
  final dir = Platform.environment['TASK_SEARCH_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures for nav72', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    Future<void> shoot(String name, String? words) async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer(overrides: [
        taskServiceProvider.overrideWithValue(FakeTaskList(_tasks)),
        themeListProvider.overrideWith((ref) async => sampleTaskThemes),
        categoryListProvider.overrideWith((ref) async => _categories()),
        defaultCategoryIdProvider.overrideWith((ref) async => '1'),
      ]);
      addTearDown(container.dispose);
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(UncontrolledProviderScope(
        key: UniqueKey(),
        container: container,
        child: RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(debugShowCheckedModeBanner: false, theme: AppTheme.lightTheme, home: const TaskListScreen()),
        ),
      ));
      await tester.pumpAndSettle();
      // 状態の条件（未着手）も重ねて、チップ列と検索が重なることを見せる
      container.read(taskFilterProvider.notifier).state = const TaskFilter(themeId: '11', status: 'todo');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('task-search-open')));
      await tester.pump();
      if (words != null) await tester.enterText(find.byKey(const ValueKey('task-search-field')), words);
      // 入力欄のカーソル点滅は止まらないので、一定時間だけ進めてから撮る
      await tester.pump(const Duration(seconds: 1));
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/dummy_nav72_$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    // ① 語句「ログイン」で、表示中の一覧（スマホアプリ・未着手）がその場で絞られている（説明だけに一致するものも出る）
    await shoot('1_search_narrowed', 'ログイン');
    // ② 検索モードで語句が空 = 一覧はそのまま
    await shoot('2_search_empty_words', null);
    // ③ 1件も合わない = 一覧の場所に空表示（別画面にしない）
    await shoot('3_search_no_match', '存在しない語');
  }, skip: dir == null);
}

/// Replaces the test font with real ones so the PNGs are readable.
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'MaterialIcons': ['$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'],
  };
  for (final entry in fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      final file = File(path);
      if (!file.existsSync()) continue;
      loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  }
}
