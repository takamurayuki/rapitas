/// Tasks screen search mode (nav72): shaped like the executions screen search
/// mode — the search icon swaps the AppBar for back arrow + field + clear +
/// voice indicator, and the visible list (theme / status / priority applied)
/// is narrowed in place by title or description on the phone. No server
/// search, no separate loading / failure screens; the applied-filter chips
/// stay and stack with the query.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/task_list/task_list_screen.dart';
import 'package:rapitas_mobile/screens/task_list/task_search_app_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'task_filter_selection_test.dart' show FakeTaskList, buildTaskListApp;

Task _task(String id, String title, String themeId, {String status = 'todo', String? description}) => Task(
      id: id,
      title: title,
      description: description,
      status: status,
      themeId: themeId,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

// 初期選択テーマは ☆ の「スマホアプリ」（id 11）
final _tasks = [
  _task('1', 'Login 画面のエラー表示', '11', status: 'in-progress'),
  _task('2', 'ホーム画面の不具合', '11', description: 'ログイン後に白くなる'),
  _task('3', '通知設定の整理', '11'),
  _task('4', 'login API の見直し', '10'), // 別テーマ。検索でも出ない
];

/// サーバ検索を呼んだら記録する（この画面では呼ばれないことを見る）
class _CountingTasks extends FakeTaskList {
  int searchCalls = 0;
  int listCalls = 0;

  _CountingTasks() : super(List.of(_tasks));

  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) {
    listCalls++;
    return super.getTasks(status: status, themeId: themeId, priority: priority);
  }

  @override
  Future<List<Task>> searchTasks(String query) async {
    searchCalls++;
    return const [];
  }
}

final _field = find.byKey(const ValueKey('task-search-field'));
final _chip = find.widgetWithText(InputChip, 'テーマ：開発 › スマホアプリ');
final _noMatch = find.text('キーワードに一致するタスクはありません');

TextField _textField(WidgetTester tester) => tester.widget<TextField>(_field);

/// 検索欄に入力フォーカスがあるか（primaryFocus の context は EditableText 内の Focus なので祖先で見る）
bool _fieldFocused() =>
    FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<TextField>() != null;

Future<_CountingTasks> _pump(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  final service = _CountingTasks();
  await tester.pumpWidget(buildTaskListApp(service));
  await tester.pumpAndSettle();
  return service;
}

Future<void> _openSearch(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('task-search-open')));
  await tester.pumpAndSettle();
}

ProviderContainer _container(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(TaskListScreen)));

void main() {
  group('applyTaskSearch', () {
    test('タイトルか説明の部分一致。大文字小文字は区別せず、前後の空白は無視、並びは元のまま', () {
      expect(applyTaskSearch(_tasks, ' LOGIN ').map((t) => t.id), ['1', '4']);
      expect(applyTaskSearch(_tasks, 'ログイン').map((t) => t.id), ['2'], reason: '説明だけに一致');
      expect(applyTaskSearch(_tasks, '画面').map((t) => t.id), ['1', '2']);
    });

    test('空の語句はそのまま、何も合わなければ空', () {
      expect(applyTaskSearch(_tasks, '  '), same(_tasks));
      expect(applyTaskSearch(_tasks, '存在しない'), isEmpty);
    });
  });

  testWidgets('通常時は検索アイコン。タップで実行画面と同じ形の検索モード AppBar になり、自動フォーカスする', (tester) async {
    await _pump(tester);
    expect(_field, findsNothing, reason: '常時表示の検索欄は無い');
    expect(find.byTooltip('検索'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsOneWidget);

    await _openSearch(tester);
    expect(find.byTooltip('検索を閉じる'), findsOneWidget);
    final field = _textField(tester);
    expect(field.autofocus, isTrue);
    expect(field.decoration!.hintText, 'タスクを検索');
    expect(field.decoration!.border, InputBorder.none);
    expect(field.decoration!.filled, isFalse);
    expect(_fieldFocused(), isTrue);
    expect(tester.widget<AppBar>(find.byType(AppBar)).title, isA<TextField>(), reason: '入力欄は AppBar の中');
    expect(find.byKey(const ValueKey('task-search-clear')), findsNothing, reason: '入力が無いときはクリアを出さない');
    expect(find.byType(FloatingActionButton), findsNothing, reason: '検索モード中は作成FABを出さない');
    expect(tester.widget<Scaffold>(find.byType(Scaffold).first).drawer, isNull);
    // 語句が空なら一覧はそのまま、チップ列も出たまま
    expect(_chip, findsOneWidget);
    expect(find.text('Login 画面のエラー表示'), findsOneWidget);
    expect(find.text('ホーム画面の不具合'), findsOneWidget);
    expect(find.text('通知設定の整理'), findsOneWidget);
  });

  testWidgets('入力すると待たずにその場で絞る（サーバ検索はしない）。テーマの条件と重なり、チップ列は出たまま', (tester) async {
    final service = await _pump(tester);
    await _openSearch(tester);
    await tester.enterText(_field, 'login');
    await tester.pump();

    expect(find.text('Login 画面のエラー表示'), findsOneWidget, reason: '大文字小文字を区別しない');
    expect(find.text('login API の見直し'), findsNothing, reason: '別テーマのタスクは出ない（表示中の一覧を絞る）');
    expect(find.text('ホーム画面の不具合'), findsNothing);
    expect(_chip, findsOneWidget);
    expect(find.byKey(const ValueKey('task-search-clear')), findsOneWidget);

    await tester.enterText(_field, 'ログイン');
    await tester.pump();
    expect(find.text('ホーム画面の不具合'), findsOneWidget, reason: '説明にも一致する');
    expect(find.text('Login 画面のエラー表示'), findsNothing);
    await tester.pumpAndSettle();
    expect(service.searchCalls, 0);
  });

  testWidgets('状態の絞り込みとも重なる', (tester) async {
    await _pump(tester);
    _container(tester).read(taskFilterProvider.notifier).state = const TaskFilter(themeId: '11', status: 'todo');
    await tester.pumpAndSettle();
    await _openSearch(tester);
    await tester.enterText(_field, '画面');
    await tester.pump();
    expect(find.text('ホーム画面の不具合'), findsOneWidget);
    expect(find.text('Login 画面のエラー表示'), findsNothing, reason: '進行中は状態の条件で外れている');
    expect(find.widgetWithText(InputChip, 'ステータス：未着手'), findsOneWidget);
  });

  testWidgets('1件も合わなければ一覧の場所に空表示。クリアで一覧に戻る', (tester) async {
    await _pump(tester);
    await _openSearch(tester);
    await tester.enterText(_field, '存在しない語');
    await tester.pump();
    expect(_noMatch, findsOneWidget);
    expect(find.text('タスクはありません'), findsNothing, reason: '一覧の空表示とは区別する');
    expect(_chip, findsOneWidget, reason: '別画面にしない');

    await tester.tap(find.byKey(const ValueKey('task-search-clear')));
    await tester.pump();
    expect(_textField(tester).controller!.text, isEmpty);
    expect(_noMatch, findsNothing);
    expect(find.text('通知設定の整理'), findsOneWidget);
    expect(find.byTooltip('検索を閉じる'), findsOneWidget, reason: 'クリアでは検索モードは閉じない');
  });

  testWidgets('絞り込みで既に0件でも、語句があれば「キーワードに一致しない」を出す。語句が空なら通常の空表示', (tester) async {
    await _pump(tester);
    _container(tester).read(taskFilterProvider.notifier).state = const TaskFilter(themeId: '11', status: 'done');
    await tester.pumpAndSettle();
    await _openSearch(tester);
    expect(find.text('条件に合うタスクはありません'), findsOneWidget, reason: '語句が空なら従来どおり');
    expect(_noMatch, findsNothing);

    await tester.enterText(_field, 'login');
    await tester.pump();
    expect(find.byKey(const ValueKey('task-search-no-match')), findsOneWidget);
    expect(_noMatch, findsOneWidget);
    expect(find.text('条件に合うタスクはありません'), findsNothing);
    expect(find.text('フィルターを解除'), findsNothing);

    await tester.enterText(_field, '   ');
    await tester.pump();
    expect(find.text('条件に合うタスクはありません'), findsOneWidget, reason: '空白だけは語句なし扱い');
    expect(_noMatch, findsNothing);
  });

  testWidgets('テーマだけで0件のときも、語句があれば「タスクはありません」ではなく検索の空表示', (tester) async {
    await _pump(tester);
    _container(tester).read(taskFilterProvider.notifier).state = const TaskFilter(themeId: '99');
    await tester.pumpAndSettle();
    expect(find.text('タスクはありません'), findsOneWidget);
    await _openSearch(tester);
    await tester.enterText(_field, 'login');
    await tester.pump();
    expect(_noMatch, findsOneWidget);
    expect(find.text('タスクはありません'), findsNothing);
  });

  testWidgets('閉じる矢印・システムの戻るで検索モードを閉じ、語句は消える', (tester) async {
    await _pump(tester);
    await _openSearch(tester);
    await tester.enterText(_field, 'login');
    await tester.pump();
    await tester.tap(find.byTooltip('検索を閉じる'));
    await tester.pumpAndSettle();
    expect(_field, findsNothing);
    expect(find.text('ホーム画面の不具合'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsOneWidget);

    await _openSearch(tester);
    expect(_textField(tester).controller!.text, isEmpty, reason: '閉じたら語句は消える');
    await tester.enterText(_field, 'login');
    await tester.pump();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(_field, findsNothing);
    expect(find.byType(TaskListScreen), findsOneWidget, reason: '画面は閉じない');
    expect(find.text('ホーム画面の不具合'), findsOneWidget);
  });

  testWidgets('声の「検索 ◯◯」は検索モードを開いて語句を入れるが、フォーカスしない', (tester) async {
    await _pump(tester);
    _container(tester).read(voiceTaskSearchRequestProvider.notifier).state = 'login';
    await tester.pumpAndSettle();
    expect(_textField(tester).controller!.text, 'login');
    expect(_textField(tester).autofocus, isFalse);
    expect(_fieldFocused(), isFalse);
    expect(find.text('Login 画面のエラー表示'), findsOneWidget);
    expect(find.text('通知設定の整理'), findsNothing);
  });

  testWidgets('検索モード中の引っ張って更新は一覧を取り直し、絞りは掛かり直す', (tester) async {
    final service = await _pump(tester);
    await _openSearch(tester);
    await tester.enterText(_field, '画面');
    await tester.pump();
    service.tasks.add(_task('5', '設定画面の追加', '11'));
    final before = service.listCalls;
    await tester.fling(find.text('Login 画面のエラー表示'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(service.listCalls, greaterThan(before));
    expect(find.text('設定画面の追加'), findsOneWidget);
    expect(find.text('通知設定の整理'), findsNothing);
    expect(_textField(tester).controller!.text, '画面');
    expect(service.searchCalls, 0);
  });
}
