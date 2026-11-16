import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/task_list/task_list_screen.dart';
import 'package:rapitas_mobile/services/filter_selection.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

// タスク一覧のフィルター：☆ の初期選択、「すべて」「指定なし」の廃止、カテゴリ切替、選択の記憶

/// themeId で絞った結果を返し、受けた themeId を記録する TaskService
class FakeTaskList implements TaskService {
  final List<Task> tasks;
  final List<String?> themeIds = [];

  FakeTaskList(this.tasks);

  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async {
    themeIds.add(themeId);
    return [
      for (final t in tasks)
        if ((themeId == null || t.themeId == themeId) && (status == null || t.status == status)) t,
    ];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final _dev = TaskCategory(id: '1', name: '開発', color: '#3B82F6', sortOrder: 1);
final _study = TaskCategory(id: '2', name: '学習', color: '#10B981', sortOrder: 2);

/// 表示確認・画面テストで共用するダミーデータ（開発: rapitas / スマホアプリ☆、学習: 英語 / 資格）
final sampleTaskThemes = [
  TaskTheme(id: '10', name: 'rapitas', color: '#6366F1', categoryId: '1', category: _dev, taskCount: 12),
  TaskTheme(
      id: '11', name: 'スマホアプリ', color: '#F59E0B', categoryId: '1', category: _dev, taskCount: 5, isDefault: true),
  TaskTheme(id: '20', name: '英語', color: '#EF4444', categoryId: '2', category: _study, taskCount: 3),
  TaskTheme(id: '21', name: '資格', color: '#8B5CF6', categoryId: '2', category: _study, taskCount: 2),
  // カテゴリ削除で残った例外状態のテーマ。候補には出さない
  TaskTheme(id: '90', name: '迷子テーマ', categoryId: null),
];

Task _task(String id, String title, String themeId, {String status = 'todo'}) => Task(
      id: id,
      title: title,
      status: status,
      themeId: themeId,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

final sampleTasks = [
  _task('1', 'フィルターの初期選択', '11', status: 'in-progress'),
  _task('2', 'ホーム画面の不具合', '11'),
  _task('3', 'リリース手順の整理', '10'),
  _task('4', '単語帳 100 語', '20'),
];

Widget buildTaskListApp(FakeTaskList service, {String? defaultCategoryId = '1'}) {
  return ProviderScope(
    overrides: [
      taskServiceProvider.overrideWithValue(service),
      themeListProvider.overrideWith((ref) async => sampleTaskThemes),
      categoryListProvider.overrideWith((ref) async => [_dev, _study]),
      defaultCategoryIdProvider.overrideWith((ref) async => defaultCategoryId),
    ],
    child: const MaterialApp(home: TaskListScreen()),
  );
}

void main() {
  late FakeTaskList service;

  setUp(() {
    service = FakeTaskList(sampleTasks);
    SharedPreferences.setMockInitialValues({});
  });

  TaskFilter filterOf(WidgetTester tester) =>
      ProviderScope.containerOf(tester.element(find.byType(TaskListScreen))).read(taskFilterProvider);

  Finder inSheet(Finder matching) =>
      find.descendant(of: find.byType(BottomSheet), matching: matching);

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byTooltip('フィルター'));
    await tester.pumpAndSettle();
  }

  testWidgets('初期表示は ☆カテゴリの ☆テーマ。最初の取得からテーマで絞り、テーマのチップに × は無い', (tester) async {
    await tester.pumpWidget(buildTaskListApp(service));
    await tester.pumpAndSettle();

    expect(service.themeIds.first, '11');
    expect(filterOf(tester).themeId, '11');
    final chip = tester.widget<InputChip>(find.widgetWithText(InputChip, 'テーマ：開発 › スマホアプリ'));
    expect(chip.onDeleted, isNull);
    expect(find.text('フィルターの初期選択'), findsOneWidget);
    expect(find.text('リリース手順の整理'), findsNothing);
    // テーマだけの指定は「絞り込み中」のバッジにしない（テーマは常に選ばれている）
    final badge = tester.widget<Badge>(
        find.descendant(of: find.byTooltip('フィルター'), matching: find.byType(Badge)));
    expect(badge.isLabelVisible, isFalse);
  });

  testWidgets('シートにカテゴリの「すべて」とテーマの「指定なし」が無く、テーマ候補は選択中カテゴリのものだけ', (tester) async {
    await tester.pumpWidget(buildTaskListApp(service));
    await tester.pumpAndSettle();
    await openSheet(tester);

    expect(inSheet(find.widgetWithText(ChoiceChip, 'すべて')), findsNothing);
    expect(inSheet(find.text('指定なし')), findsNothing);
    // 「すべて」はステータス・優先度の2つだけ
    expect(inSheet(find.widgetWithText(FilterChip, 'すべて')), findsNWidgets(2));
    final devChip = tester.widget<ChoiceChip>(inSheet(find.widgetWithText(ChoiceChip, '開発')));
    expect(devChip.selected, isTrue);
    expect(inSheet(find.text('スマホアプリ（5）')), findsOneWidget);
    expect(inSheet(find.text('英語（3）')), findsNothing);
    expect(inSheet(find.textContaining('迷子テーマ')), findsNothing);
  });

  testWidgets('カテゴリを切り替えるとそのカテゴリの先頭テーマを即適用して記憶し、テーマを選ぶと閉じて記憶する', (tester) async {
    await tester.pumpWidget(buildTaskListApp(service));
    await tester.pumpAndSettle();
    await openSheet(tester);

    await tester.tap(inSheet(find.widgetWithText(ChoiceChip, '学習')));
    await tester.pumpAndSettle();
    expect(filterOf(tester).themeId, '20');
    expect(tester.widget<FilterChip>(inSheet(find.widgetWithText(FilterChip, '英語（3）'))).selected, isTrue);

    await tester.tap(inSheet(find.widgetWithText(FilterChip, '資格（2）')));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(filterOf(tester).themeId, '21');
    final memory = await FilterSelectionStore.loadTask();
    expect(memory.lastCategoryId, '2');
    expect(memory.themeByCategory, {'2': '21'});
  });

  testWidgets('記憶があれば ☆ より記憶を優先する', (tester) async {
    SharedPreferences.setMockInitialValues({
      FilterSelectionStore.lastCategoryKey: '2',
      FilterSelectionStore.themeByCategoryKey: '{"2":"20"}',
    });
    await tester.pumpWidget(buildTaskListApp(service));
    await tester.pumpAndSettle();
    expect(filterOf(tester).themeId, '20');
    expect(find.text('単語帳 100 語'), findsOneWidget);
  });

  testWidgets('ステータスの絞り込みを外してもテーマは残る', (tester) async {
    await tester.pumpWidget(buildTaskListApp(service));
    await tester.pumpAndSettle();
    await openSheet(tester);
    await tester.tap(inSheet(find.widgetWithText(FilterChip, '進行中')));
    await tester.pumpAndSettle();
    expect(filterOf(tester), const TaskFilter(themeId: '11', status: 'in-progress'));

    await tester.tap(find.byTooltip('ステータスの絞り込みを解除'));
    await tester.pumpAndSettle();
    expect(filterOf(tester), const TaskFilter(themeId: '11'));
  });
}
