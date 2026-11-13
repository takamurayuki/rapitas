/// Task detail subtask section: creating a subtask (POST /tasks with parentId,
/// same body as the desktop add form) and the desktop-equivalent progress bar,
/// on both the detail screen and the task list card.
///
/// Set TASK_DETAIL_SCREENSHOT_DIR to also write light/dark PNG screenshots
/// with real fonts for visual review; CI leaves it unset.
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
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/task_detail/subtask_section.dart';
import 'package:rapitas_mobile/screens/task_detail/task_detail_screen.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/widgets/subtask_progress.dart';
import 'package:rapitas_mobile/widgets/task_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _boundaryKey = GlobalKey();

Task _sub(String id, String title, String status) => Task(
      id: id,
      title: title,
      status: status,
      parentId: '10',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

Task _parent(List<Task> subtasks) => Task(
      id: '10',
      title: 'スマホ版のサブタスク対応',
      status: 'in-progress',
      priority: 'high',
      estimatedHours: 3,
      subtasks: subtasks,
      dueDate: DateTime(2026, 11, 20),
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

final _mixed = [
  _sub('11', 'デスクトップの実装を確認する', 'done'),
  _sub('12', '作成フォームを作る', 'done'),
  _sub('13', '進捗バーを付ける', 'in-progress'),
  _sub('14', '画面キャプチャを撮る', 'todo'),
];

class _FakeTasks implements TaskService {
  final List<Map<String, dynamic>> created = [];
  bool fail = false;

  @override
  Future<Task> createTask(Map<String, dynamic> data) async {
    if (fail) throw Exception('500');
    created.add(data);
    return _sub('99', data['title'] as String, 'todo');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _pumpDetail(
  WidgetTester tester,
  Task task, {
  _FakeTasks? service,
  ThemeData? theme,
  int Function()? onDetailLoad,
}) async {
  SharedPreferences.setMockInitialValues({});
  // The section sits low in a lazy ListView; a tall phone-width view builds it.
  if (theme == null) {
    tester.view.physicalSize = const Size(1170, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }
  await tester.pumpWidget(ProviderScope(
    overrides: [
      taskDetailProvider.overrideWith((ref, id) async {
        onDetailLoad?.call();
        return task;
      }),
      taskServiceProvider.overrideWithValue(service ?? _FakeTasks()),
    ],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? AppTheme.lightTheme,
        home: const TaskDetailScreen(taskId: '10'),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('buildSubtaskCreateBody (desktop useSubtaskManagement.addSubtask)', () {
    test('sends parentId as a number, status todo and the trimmed title', () {
      expect(
        buildSubtaskCreateBody(parentId: '10', title: '  作成フォーム  '),
        {'title': '作成フォーム', 'parentId': 10, 'status': 'todo', 'priority': 'medium'},
      );
    });

    test('includes description and estimatedHours only when given', () {
      expect(
        buildSubtaskCreateBody(
          parentId: '10',
          title: 'a',
          description: ' 説明 ',
          priority: 'high',
          estimatedHours: '1.5',
        ),
        {
          'title': 'a',
          'parentId': 10,
          'status': 'todo',
          'priority': 'high',
          'description': '説明',
          'estimatedHours': 1.5,
        },
      );
      final empty = buildSubtaskCreateBody(
          parentId: '10', title: 'a', description: '  ', estimatedHours: 'x');
      expect(empty.containsKey('description'), isFalse);
      expect(empty.containsKey('estimatedHours'), isFalse);
      expect(
        buildSubtaskCreateBody(parentId: '10', title: 'a', estimatedHours: '0')
            .containsKey('estimatedHours'),
        isFalse,
      );
    });

    test('never sends actualHours (not in the backend create schema)', () {
      expect(
        buildSubtaskCreateBody(parentId: '10', title: 'a', estimatedHours: '2')
            .containsKey('actualHours'),
        isFalse,
      );
    });

    test('rejects a non-numeric parent id', () {
      expect(() => buildSubtaskCreateBody(parentId: 'abc', title: 'a'),
          throwsArgumentError);
    });
  });

  group('SubtaskProgressCounts (desktop TaskCardSubtaskProgress)', () {
    test('counts done, in-progress (incl. blocked) and todo', () {
      final c = SubtaskProgressCounts.fromSubtasks([
        ..._mixed,
        _sub('15', 'b', 'blocked'),
      ]);
      expect(c.total, 5);
      expect(c.done, 2);
      expect(c.inProgress, 2);
      expect(c.todo, 1);
      expect(c.donePercent, 40);
      expect(c.inProgressPercent, 40);
      expect(c.isComplete, isFalse);
      expect(c.breakdown, '完了 2 / 進行中 2 / 未着手 1');
    });

    test('rounds percentages like the desktop and flags completion', () {
      final third = SubtaskProgressCounts.fromSubtasks(
          [_sub('1', 'a', 'done'), _sub('2', 'b', 'todo'), _sub('3', 'c', 'todo')]);
      expect(third.donePercent, 33);
      final all = SubtaskProgressCounts.fromSubtasks([_sub('1', 'a', 'done')]);
      expect(all.isComplete, isTrue);
      expect(SubtaskProgressCounts.fromSubtasks(null).total, 0);
      expect(SubtaskProgressCounts.fromSubtasks(const []).isComplete, isFalse);
    });
  });

  testWidgets('detail shows done/total and a bar whose segments follow the counts',
      (tester) async {
    await _pumpDetail(tester, _parent(_mixed));

    expect(find.text('サブタスク (4)'), findsOneWidget);
    expect(find.text('2/4'), findsOneWidget);
    final done = tester.getSize(find.byKey(const ValueKey('subtask-progress-done')));
    final prog =
        tester.getSize(find.byKey(const ValueKey('subtask-progress-in-progress')));
    final track = tester.getSize(find.byType(SubtaskProgressBar));
    expect(done.width, closeTo(track.width * 0.5, 0.5));
    expect(prog.width, closeTo(track.width * 0.25, 0.5));
    final text = tester.widget<Text>(find.text('2/4'));
    expect(text.style?.color, const Color(0xFF2563EB));
  });

  testWidgets('progress text turns green when every subtask is done', (tester) async {
    await _pumpDetail(tester, _parent([_sub('11', 'a', 'done'), _sub('12', 'b', 'done')]));
    expect(tester.widget<Text>(find.text('2/2')).style?.color, const Color(0xFF16A34A));
  });

  testWidgets('section and add button are shown even with no subtasks', (tester) async {
    await _pumpDetail(tester, _parent(const []));
    expect(find.text('サブタスク'), findsOneWidget);
    expect(find.byType(SubtaskProgressBar), findsNothing);
    expect(find.byKey(const ValueKey('subtask-add-toggle')), findsOneWidget);
  });

  testWidgets('creating a subtask posts the desktop body and reloads the parent',
      (tester) async {
    final service = _FakeTasks();
    var loads = 0;
    await _pumpDetail(tester, _parent(_mixed),
        service: service, onDetailLoad: () => loads++);
    expect(loads, 1);

    await tester.tap(find.byKey(const ValueKey('subtask-add-toggle')));
    await tester.pumpAndSettle();
    // Add mode shows the form alone, like the desktop.
    expect(find.text('作成フォームを作る'), findsNothing);
    final save = find.byKey(const ValueKey('subtask-save'));
    expect(tester.widget<FilledButton>(save).onPressed, isNull,
        reason: 'title is required');

    await tester.enterText(find.byKey(const ValueKey('subtask-title-field')), ' 新しいサブタスク ');
    await tester.enterText(find.byKey(const ValueKey('subtask-description-field')), '説明文');
    await tester.tap(find.widgetWithText(ChoiceChip, '高'));
    await tester.enterText(find.byKey(const ValueKey('subtask-hours-field')), '0.5');
    await tester.pump();
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();

    expect(service.created, [
      {
        'title': '新しいサブタスク',
        'parentId': 10,
        'status': 'todo',
        'priority': 'high',
        'description': '説明文',
        'estimatedHours': 0.5,
      }
    ]);
    expect(loads, 2, reason: 'parent detail is reloaded to show the new subtask');
    expect(find.byKey(const ValueKey('subtask-title-field')), findsNothing,
        reason: 'form closes after saving');
    expect(find.text('作成フォームを作る'), findsOneWidget);
  });

  testWidgets('a failed create keeps the form open and shows an error', (tester) async {
    final service = _FakeTasks()..fail = true;
    await _pumpDetail(tester, _parent(const []), service: service);
    await tester.tap(find.byKey(const ValueKey('subtask-add-toggle')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('subtask-title-field')), 'x');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(find.textContaining('サブタスクの作成に失敗しました'), findsOneWidget);
    expect(find.byKey(const ValueKey('subtask-title-field')), findsOneWidget);
  });

  testWidgets('task card shows the same progress only when it has subtasks',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: SizedBox(
          width: 390,
          child: Column(children: [
            TaskCard(task: _parent(_mixed)),
            TaskCard(task: _parent(const [])),
          ]),
        ),
      ),
    ));
    expect(find.text('2/4'), findsOneWidget);
    expect(find.byType(SubtaskProgressBar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  final screenshotDir = Platform.environment['TASK_DETAIL_SCREENSHOT_DIR'];
  testWidgets('writes light/dark screenshots', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 3600);
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

    for (final entry in {
      'light': AppTheme.lightTheme,
      'dark': AppTheme.darkTheme,
    }.entries) {
      await _pumpDetail(tester, _parent(_mixed), theme: entry.value);
      await tester.drag(find.byType(ListView).first, const Offset(0, -500));
      await tester.pumpAndSettle();
      await shoot('subtasks_detail_${entry.key}');

      await tester.tap(find.byKey(const ValueKey('subtask-add-toggle')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const ValueKey('subtask-title-field')), 'レビュー指摘を直す');
      await tester.pumpAndSettle();
      await shoot('subtasks_add_form_${entry.key}');

      // Tear the detail screen down first so its focused field is not reparented.
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(RepaintBoundary(
        key: _boundaryKey,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: entry.value,
          home: Scaffold(
            appBar: AppBar(title: const Text('タスク')),
            body: ListView(padding: const EdgeInsets.all(16), children: [
              TaskCard(task: _parent(_mixed)),
              TaskCard(
                  task: _parent([_sub('1', 'a', 'done'), _sub('2', 'b', 'done')])
                      .copyWith(title: '全部完了したタスク', status: 'done')),
              TaskCard(
                  task: _parent([
                _sub('1', 'a', 'in-progress'),
                _sub('2', 'b', 'blocked'),
                _sub('3', 'c', 'todo'),
              ]).copyWith(title: '進行中だけのタスク', priority: 'medium')),
              TaskCard(task: _parent(const []).copyWith(title: 'サブタスク無しのタスク')),
            ]),
          ),
        ),
      ));
      await tester.pumpAndSettle();
      await shoot('subtasks_task_list_${entry.key}');
    }
  }, skip: screenshotDir == null);
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
