/// nav71 captures with DUMMY data for visual review (390pt wide, real Noto
/// CJK fonts): the executions filter sheet with two themes selected and the
/// Done button, the executions screen with two theme chips applied, the tasks
/// screen inline search with results in place, and the tasks / executions
/// filter sheets side by side at the same width (few chips, so a sheet that
/// shrinks to its content would show).
///
/// Set FILTER_SEARCH_SCREENSHOT_DIR to write them; CI leaves it unset, so the
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
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:rapitas_mobile/screens/task_list/task_list_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';
import 'task_filter_selection_test.dart' show FakeTaskList, sampleTaskThemes;

Task _task(String id, String title, String themeId, {String status = 'todo', String priority = 'medium'}) => Task(
      id: id,
      title: title,
      status: status,
      priority: priority,
      themeId: themeId,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

// 実行画面用（テーマ 1・2 は categorizedThemes の開発テーマ）
final _execTasks = [
  _task('812', '【ダミー】ログイン画面のエラー表示を直す', '1'),
  _task('813', '【ダミー】ログ出力の整理', '1'),
  _task('820', '【ダミー】通知設定画面を作る', '2'),
  _task('830', '【ダミー】家計簿の月次集計', '5'),
];

DateTime _ago(int minutes) => DateTime.now().subtract(Duration(minutes: minutes));

ExecutingTask _exec(String taskId, int minutesAgo, {bool waiting = false}) => ExecutingTask(
      executionId: 'e$taskId',
      sessionId: 's$taskId',
      taskId: taskId,
      executionStatus: waiting ? 'waiting_for_input' : 'running',
      startedAt: _ago(minutesAgo),
    );

final _executing = [_exec('812', 12), _exec('813', 48, waiting: true), _exec('820', 5), _exec('830', 30)];

// タスク画面用（テーマは sampleTaskThemes の 10/11/20）
final _taskTasks = [
  _task('1', '【ダミー】フィルターの初期選択', '11', status: 'in-progress', priority: 'high'),
  _task('2', '【ダミー】ホーム画面の不具合', '11'),
  _task('3', '【ダミー】リリース手順の整理', '10'),
  _task('4', '【ダミー】画面一覧のリリースノート', '20', priority: 'low'),
];

class _SearchableTasks extends FakeTaskList {
  _SearchableTasks() : super(_taskTasks);

  @override
  Future<List<Task>> searchTasks(String query) async => tasks.where((t) => t.title.contains(query)).toList();
}

/// sampleTaskThemes に付いているカテゴリ（重複なし）
List<TaskCategory> _categories() {
  final byId = <String, TaskCategory>{};
  for (final theme in sampleTaskThemes) {
    final category = theme.category;
    if (category != null) byId[category.id] = category;
  }
  return byId.values.toList();
}

typedef _Prepare = Future<void> Function(WidgetTester tester);

void main() {
  final dir = Platform.environment['FILTER_SEARCH_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures for nav71', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    Future<void> shoot(String name, Widget Function(Key boundary) app, _Prepare? prepare) async {
      SharedPreferences.setMockInitialValues({});
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(app(boundaryKey));
      // 実行中タイルのスピナーは止まらないので、一定時間だけ進めてから撮る
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      if (prepare != null) {
        await prepare(tester);
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
      }
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/dummy_nav71_$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    Widget wrap(Key boundary, List<Override> overrides, Widget home, {ExecFilter? execFilter}) {
      final container = ProviderContainer(overrides: overrides);
      addTearDown(container.dispose);
      if (execFilter != null) container.read(execFilterProvider.notifier).state = execFilter;
      return UncontrolledProviderScope(
        key: UniqueKey(),
        container: container,
        child: RepaintBoundary(
          key: boundary,
          child: MaterialApp(debugShowCheckedModeBanner: false, theme: AppTheme.lightTheme, home: home),
        ),
      );
    }

    List<Override> execOverrides(List<TaskTheme> themes) => [
          ...autoRunScreenOverrides(
            FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': idleSnapshot('2'), '5': idleSnapshot('5')}),
            themes,
          ),
          executingTasksProvider.overrideWith((ref) async => _executing),
          resumableExecutionsProvider.overrideWith((ref) async => const []),
          taskTitleLookupProvider.overrideWithValue({for (final t in _execTasks) t.id: t.title}),
          taskListProvider.overrideWith((ref, filter) async => _execTasks),
        ];

    final taskOverrides = <Override>[
      taskServiceProvider.overrideWithValue(_SearchableTasks()),
      themeListProvider.overrideWith((ref) async => sampleTaskThemes),
      categoryListProvider.overrideWith((ref) async => _categories()),
      defaultCategoryIdProvider.overrideWith((ref) async => '1'),
    ];

    Future<void> openExecSheet(WidgetTester tester) => tester.tap(find.byKey(const ValueKey('exec-filter-open')));

    // ① 実行画面のシート：テーマ2件を選択中＋完了ボタン（シートは画面の高さの上限があるので下端までスクロールして撮る）
    await shoot(
      '1_exec_sheet_two_themes',
      (k) => wrap(k, execOverrides(categorizedThemes), const AgentExecutionScreen(),
          execFilter: const ExecFilter(themeIds: {'1', '2'})),
      (tester) async {
        await openExecSheet(tester);
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        await tester.drag(find.byKey(const ValueKey('exec-filter-sheet')), const Offset(0, -300));
      },
    );
    // ② 実行画面の適用中チップ列（テーマ2件）
    await shoot(
      '2_exec_applied_two_themes',
      (k) => wrap(k, execOverrides(categorizedThemes), const AgentExecutionScreen(),
          execFilter: const ExecFilter(themeIds: {'1', '2'})),
      null,
    );
    // ③ タスク画面のインライン検索（検索欄＋結果がその場に出ている）
    await shoot('3_task_inline_search', (k) => wrap(k, taskOverrides, const TaskListScreen()), (tester) async {
      await tester.pump(const Duration(seconds: 1));
      // 声の「検索 リリース」と同じ経路で入れる（フォーカスを当てない）
      final container = ProviderScope.containerOf(tester.element(find.byType(TaskListScreen)));
      container.read(voiceTaskSearchRequestProvider.notifier).state = 'リリース';
    });
    // ④⑤ 幅の比較：タスク画面のシートと、チップが少ない状態の実行画面のシート（同じ390pt）
    await shoot('4_task_sheet_width', (k) => wrap(k, taskOverrides, const TaskListScreen()), (tester) async {
      await tester.pump(const Duration(seconds: 1));
      await tester.tap(find.byTooltip('フィルター'));
    });
    await shoot(
      '5_exec_sheet_width_few_chips',
      (k) => wrap(k, execOverrides(dummyThemes), const AgentExecutionScreen()),
      openExecSheet,
    );
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
