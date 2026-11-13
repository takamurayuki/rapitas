/// Task detail header actions: the fixed run/stop button (driven by
/// executingTasksProvider), the thin running bar, polling only while running,
/// double-tap editing of the title and description, no 「…」 menu, and the
/// run/approval tab icons.
///
/// Set TASK_DETAIL_SCREENSHOT_DIR to also write PNG captures (real fonts,
/// dummy data) for visual review; CI leaves it unset.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/note.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/approval_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/note_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/approvals/approvals_screen.dart';
import 'package:rapitas_mobile/screens/task_detail/task_detail_screen.dart';
import 'package:rapitas_mobile/screens/task_detail/task_execution_controls.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _boundaryKey = GlobalKey();

final _devTheme = TaskTheme(
  id: '3',
  name: 'rapitas 開発',
  isDevelopment: true,
  workingDirectory: '/work/rapitas',
);

Task _task({bool executable = true, String? description = 'ログイン失敗時に理由を表示する。'}) => Task(
      id: '1',
      title: '【ダミー】ログインのエラー表示を直す',
      description: description,
      status: 'in-progress',
      priority: 'high',
      theme: executable ? _devTheme : null,
      executionInstructions: executable ? 'テストを先に書いてから直すこと' : null,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

const _running = ExecutingTask(
  executionId: '70',
  sessionId: '7',
  taskId: '1',
  executionStatus: 'running',
);

class _FakeAgent implements AgentService {
  final List<String> stopped = [];
  final List<String> executed = [];
  void Function()? onStop;

  @override
  Future<void> stopTaskExecution(String taskId) async {
    stopped.add(taskId);
    onStop?.call();
  }

  @override
  Future<TaskExecutionStart> executeTask(String taskId) async {
    executed.add(taskId);
    return TaskExecutionStart(taskId: taskId, status: 'started');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTasks implements TaskService {
  final List<Map<String, dynamic>> updates = [];

  @override
  Future<Task> updateTask(String id, Map<String, dynamic> data) async {
    updates.add(data);
    return _task();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Mutable backend state shared with the provider overrides.
class _World {
  Task task;
  bool running;
  int executingLoads = 0;
  int detailLoads = 0;
  final agent = _FakeAgent();
  final tasks = _FakeTasks();

  _World({required this.task, this.running = false});
}

Future<void> _pump(
  WidgetTester tester,
  _World world, {
  Duration? pollInterval,
  ThemeData? theme,
  bool settle = true,
}) async {
  SharedPreferences.setMockInitialValues({});
  if (theme == null) {
    tester.view.physicalSize = const Size(1170, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      taskDetailProvider.overrideWith((ref, id) async {
        world.detailLoads++;
        return world.task;
      }),
      executingTasksProvider.overrideWith((ref) async {
        world.executingLoads++;
        return world.running ? const [_running] : const <ExecutingTask>[];
      }),
      taskNotesProvider.overrideWith((ref, id) async => const <Note>[]),
      taskExecutionPollIntervalProvider.overrideWithValue(pollInterval),
      agentServiceProvider.overrideWithValue(world.agent),
      taskServiceProvider.overrideWithValue(world.tasks),
    ],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? AppTheme.lightTheme,
        home: const TaskDetailScreen(taskId: '1'),
      ),
    ),
  ));
  // The running bar animates forever, so a running screen is pumped, not settled.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }
}

final _runButton = find.byKey(const ValueKey('task-detail-execute'));
final _stopButton = find.byKey(const ValueKey('task-detail-stop'));
final _runningBar = find.byKey(const ValueKey('task-detail-executing-bar'));

Future<void> _doubleTap(WidgetTester tester, Finder target) async {
  await tester.tap(target);
  await tester.pump(kDoubleTapMinTime);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  group('header run/stop', () {
    testWidgets('idle executable task: play_circle in the header, no bottom button, no 「…」',
        (tester) async {
      await _pump(tester, _World(task: _task()));

      expect(_runButton, findsOneWidget);
      expect(find.descendant(of: _runButton, matching: find.byIcon(Icons.play_circle)),
          findsOneWidget);
      expect(_stopButton, findsNothing);
      expect(_runningBar, findsNothing);
      expect(find.byType(PopupMenuButton<String>), findsNothing);
      expect(find.byIcon(Icons.more_vert), findsNothing);
      expect(find.text('エージェントで実行'), findsNothing);
      expect(find.text('AI実行可能'), findsOneWidget);
      expect(find.byTooltip('編集'), findsOneWidget);
    });

    testWidgets('a task that cannot run shows neither button nor card', (tester) async {
      await _pump(tester, _World(task: _task(executable: false)));
      expect(_runButton, findsNothing);
      expect(_stopButton, findsNothing);
      expect(find.byKey(const ValueKey('task-detail-execution-card')), findsNothing);
    });

    testWidgets('running: stop_circle in error color, thin bar, card says AI実行中',
        (tester) async {
      await _pump(tester, _World(task: _task(), running: true), settle: false);

      expect(_runButton, findsNothing);
      final icon = tester.widget<Icon>(
          find.descendant(of: _stopButton, matching: find.byIcon(Icons.stop_circle)));
      expect(icon.color, AppTheme.lightTheme.colorScheme.error);
      expect(_runningBar, findsOneWidget);
      expect(find.text('AI実行中'), findsOneWidget);
      expect(find.text('AI実行可能'), findsNothing);
    });

    testWidgets('running shows stop even when the task is not executable', (tester) async {
      await _pump(tester, _World(task: _task(executable: false), running: true),
          settle: false);
      expect(_stopButton, findsOneWidget);
      expect(find.text('AI実行中'), findsOneWidget);
    });

    testWidgets('stop asks first, stops, reloads and returns to the run button',
        (tester) async {
      final world = _World(task: _task(), running: true);
      world.agent.onStop = () => world.running = false;
      await _pump(tester, world, settle: false);

      await tester.tap(_stopButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('「【ダミー】ログインのエラー表示を直す」の実行を停止しますか？'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, '停止'));
      await tester.pumpAndSettle();

      expect(world.agent.stopped, ['1']);
      expect(find.text('実行を停止しました'), findsOneWidget);
      expect(_stopButton, findsNothing);
      expect(_runButton, findsOneWidget);
      expect(_runningBar, findsNothing);
      expect(world.detailLoads, greaterThan(1));
    });

    testWidgets('cancelling the stop dialog does nothing', (tester) async {
      final world = _World(task: _task(), running: true);
      await _pump(tester, world, settle: false);
      await tester.tap(_stopButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('いいえ'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(world.agent.stopped, isEmpty);
      expect(_stopButton, findsOneWidget);
    });

    testWidgets('run keeps the confirmation and then calls execute', (tester) async {
      final world = _World(task: _task());
      await _pump(tester, world);
      await tester.tap(_runButton);
      await tester.pumpAndSettle();
      expect(find.text('このタスクをAIエージェントで実行しますか？'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, '実行'));
      await tester.pumpAndSettle();
      expect(world.agent.executed, ['1']);
      expect(find.text('エージェント実行を開始しました'), findsOneWidget);
    });
  });

  group('polling', () {
    testWidgets('polls every interval only while running and stops when it ends',
        (tester) async {
      final world = _World(task: _task(), running: true);
      await _pump(tester, world, pollInterval: const Duration(seconds: 10), settle: false);
      final before = world.executingLoads;
      final detailBefore = world.detailLoads;

      await tester.pump(const Duration(seconds: 10));
      await tester.pump();
      expect(world.executingLoads, before + 1);
      expect(world.detailLoads, detailBefore + 1);

      world.running = false;
      await tester.pump(const Duration(seconds: 10));
      await tester.pumpAndSettle();
      expect(_runButton, findsOneWidget, reason: 'finished run turns the button back');
      final settled = world.executingLoads;
      await tester.pump(const Duration(seconds: 30));
      expect(world.executingLoads, settled, reason: 'no polling once idle');
    });

    testWidgets('an idle screen never starts the timer', (tester) async {
      final world = _World(task: _task());
      await _pump(tester, world, pollInterval: const Duration(seconds: 10));
      final loads = world.executingLoads;
      await tester.pump(const Duration(seconds: 30));
      expect(world.executingLoads, loads);
    });
  });

  group('double-tap edit', () {
    testWidgets('title: opens a one-line dialog and saves only the title', (tester) async {
      final world = _World(task: _task());
      await _pump(tester, world);
      final loads = world.detailLoads;

      await _doubleTap(tester, find.byKey(const ValueKey('task-inline-title')));
      expect(find.text('タイトルを編集'), findsOneWidget);
      final field = find.byKey(const ValueKey('task-inline-edit-field'));
      expect(tester.widget<TextField>(field).maxLines, 1);

      await tester.enterText(field, '  ');
      await tester.pump();
      final save = find.byKey(const ValueKey('task-inline-edit-save'));
      expect(tester.widget<FilledButton>(save).onPressed, isNull,
          reason: 'empty title cannot be saved');

      await tester.enterText(field, ' 新しいタイトル ');
      await tester.pump();
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(world.tasks.updates, [
        {'title': '新しいタイトル'}
      ]);
      expect(world.detailLoads, loads + 1);
      expect(find.text('タイトルを編集'), findsNothing);
    });

    testWidgets('description: raw Markdown saved verbatim, whitespace included', (tester) async {
      final world = _World(task: _task(description: '    code\n- **手順2**'));
      await _pump(tester, world);

      await _doubleTap(tester, find.byKey(const ValueKey('task-inline-description')));
      expect(find.text('説明を編集'), findsOneWidget);
      final field = find.byKey(const ValueKey('task-inline-edit-field'));
      expect(tester.widget<TextField>(field).controller!.text, '    code\n- **手順2**');
      expect(tester.widget<TextField>(field).maxLines, greaterThan(1));

      final save = find.byKey(const ValueKey('task-inline-edit-save'));
      await tester.enterText(field, '    code2\n- 手順3');
      await tester.tap(save);
      await tester.pumpAndSettle();
      // a whitespace-only change (indent the list item) is still a change
      await _doubleTap(tester, find.byKey(const ValueKey('task-inline-description')));
      await tester.enterText(field, '    code\n  - **手順2**');
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(world.tasks.updates, [
        {'description': '    code2\n- 手順3'},
        {'description': '    code\n  - **手順2**'},
      ]);
    });

    testWidgets('cancel leaves the task unchanged', (tester) async {
      final world = _World(task: _task());
      await _pump(tester, world);
      await _doubleTap(tester, find.byKey(const ValueKey('task-inline-title')));
      await tester.enterText(find.byKey(const ValueKey('task-inline-edit-field')), '別の名前');
      await tester.tap(find.text('キャンセル'));
      await tester.pumpAndSettle();
      expect(world.tasks.updates, isEmpty);
    });

    testWidgets('a single tap does not open the dialog', (tester) async {
      await _pump(tester, _World(task: _task()));
      await tester.tap(find.byKey(const ValueKey('task-inline-title')));
      await tester.pumpAndSettle();
      expect(find.text('タイトルを編集'), findsNothing);
    });
  });

  testWidgets('bottom tabs: 実行 = play_circle, 承認 = fact_check', (tester) async {
    await _pumpShell(tester, AppRoutes.executions);
    expect(find.byIcon(Icons.play_circle), findsOneWidget, reason: 'selected 実行 tab');
    expect(find.byIcon(Icons.fact_check_outlined), findsOneWidget);
    expect(find.byIcon(Icons.smart_toy), findsNothing);
    expect(find.byIcon(Icons.smart_toy_outlined), findsNothing);
    expect(find.byIcon(Icons.approval_outlined), findsNothing);
    expect(find.byIcon(Icons.play_circle_outline), findsOneWidget, reason: 'empty state');

    await _pumpShell(tester, AppRoutes.approvals);
    expect(find.byIcon(Icons.play_circle_outline), findsOneWidget);
    expect(find.byIcon(Icons.fact_check), findsNWidgets(2),
        reason: 'selected 承認 tab and the empty state');
  });

  final screenshotDir = Platform.environment['TASK_DETAIL_SCREENSHOT_DIR'];
  testWidgets('writes captures (dummy data)', (tester) async {
    await _loadRealFonts();
    // flutter_test draws elevation as solid black outlines; show real shadows in the PNGs.
    debugDisableShadows = false;
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    Future<void> shoot(String name) async {
      final boundary =
          tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$screenshotDir/$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    for (final entry in {'light': AppTheme.lightTheme, 'dark': AppTheme.darkTheme}.entries) {
      final world = _World(
          task: _task(description: 'パスワードを間違えたときに何も出ないので、**理由**を出す。'));
      await _pump(tester, world, theme: entry.value);
      await shoot('detail_idle_top_${entry.key}');
      await tester.drag(find.byType(ListView).first, const Offset(0, -2000));
      await tester.pumpAndSettle();
      await shoot('detail_idle_bottom_${entry.key}');

      world.running = true;
      await _pump(tester, world, theme: entry.value, settle: false);
      await tester.pump(const Duration(milliseconds: 600));
      await shoot('detail_running_top_${entry.key}');
      await tester.drag(find.byType(ListView).first, const Offset(0, -2000));
      await tester.pump(const Duration(milliseconds: 600));
      await shoot('detail_running_bottom_${entry.key}');

      await _pump(tester, _World(task: world.task), theme: entry.value);
      await _doubleTap(tester, find.byKey(const ValueKey('task-inline-title')));
      await shoot('edit_title_dialog_${entry.key}');
      await tester.tap(find.text('キャンセル'));
      await tester.pumpAndSettle();
      await _doubleTap(tester, find.byKey(const ValueKey('task-inline-description')));
      await shoot('edit_description_dialog_${entry.key}');
      await tester.pumpWidget(const SizedBox());

      await _pumpShell(tester, AppRoutes.executions, theme: entry.value);
      await shoot('tabs_executions_${entry.key}');
      await _pumpShell(tester, AppRoutes.approvals, theme: entry.value);
      await shoot('tabs_approvals_${entry.key}');
    }
    // Must be restored inside the body: the painting-vars check runs before tearDowns.
    debugDisableShadows = true;
  }, skip: screenshotDir == null);
}

/// The real tab shell around the real (empty) 実行 / 承認 screens.
Future<void> _pumpShell(WidgetTester tester, String location, {ThemeData? theme}) async {
  SharedPreferences.setMockInitialValues({});
  final router = GoRouter(
    initialLocation: location,
    routes: [
      ShellRoute(
        builder: (context, state, child) => ScaffoldWithNavBar(child: child),
        routes: [
          GoRoute(
              path: AppRoutes.executions,
              builder: (context, state) => const AgentExecutionScreen()),
          GoRoute(
              path: AppRoutes.approvals, builder: (context, state) => const ApprovalsScreen()),
        ],
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      executingTasksProvider.overrideWith((ref) async => const <ExecutingTask>[]),
      resumableExecutionsProvider.overrideWith((ref) async => const <ResumableExecution>[]),
      taskTitleLookupProvider.overrideWithValue(const {}),
      approvalListProvider.overrideWith((ref) async => const []),
    ],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        theme: theme ?? AppTheme.lightTheme,
        routerConfig: router,
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

/// Replaces the test font with real ones so the PNGs are readable.
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'MaterialIcons': [
      '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ],
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
