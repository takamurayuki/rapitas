import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/backlog_provider.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/backlog/ideas_screen.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';
import 'package:rapitas_mobile/services/filter_selection.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// バックエンドの絞り込みを手元で真似る BacklogService（themeId・priority・status・search）。
/// themeId='none' はテーマ未定のアイデアだけ（GET /idea-box?themeId=none）。
class FakeIdeaBacklog implements BacklogService {
  final List<Idea> ideas;
  final List<Map<String, String?>> calls = [];

  /// テーマ変更（PATCH /idea-box/:id）の記録（アイデアID, テーマID または null）
  final List<(String, String?)> themeUpdates = [];

  FakeIdeaBacklog(this.ideas);

  @override
  Future<List<Idea>> getIdeas({
    String? themeId,
    String? priority,
    String? status,
    String? search,
  }) async {
    calls.add({'themeId': themeId, 'priority': priority, 'status': status, 'search': search});
    return ideas.where((i) {
      if (themeId == ideaNoThemeId && i.themeId != null) return false;
      if (themeId != null && themeId != ideaNoThemeId && i.themeId != themeId) return false;
      if (priority != null && i.priority != priority) return false;
      if (status == 'used' && i.usedInTaskId == null) return false;
      if (status == 'open' && i.usedInTaskId != null) return false;
      if (search != null && search.isNotEmpty && !i.title.contains(search)) return false;
      return true;
    }).toList();
  }

  @override
  Future<void> updateIdeaTheme(String id, String? themeId) async => themeUpdates.add((id, themeId));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 表示確認・画面テストで共用するダミーデータ
final sampleIdeas = [
  Idea(
    id: '1',
    title: '音声で優先度を変えられるようにする',
    content: '',
    priority: 'high',
    scope: 'project',
    themeId: '10',
    createdAt: DateTime(2026, 11, 10),
  ),
  Idea(
    id: '2',
    title: 'ホーム画面ウィジェットに今日のタスク',
    content: '',
    priority: 'medium',
    scope: 'project',
    themeId: '11',
    usedInTaskId: '501',
    createdAt: DateTime(2026, 11, 8),
  ),
  Idea(
    id: '3',
    title: '通知の既読をまとめて付ける',
    content: '',
    priority: 'low',
    scope: 'global',
    createdAt: DateTime(2026, 11, 5),
  ),
];

final sampleThemes = [
  TaskTheme(id: '10', name: 'スマホアプリ', categoryId: '1'),
  TaskTheme(id: '11', name: 'デスクトップ', categoryId: '1'),
];

Widget buildIdeasApp(
  FakeIdeaBacklog backlog, {
  List<TaskTheme>? themes,
  String? defaultCategoryId,
}) {
  return ProviderScope(
    overrides: [
      backlogServiceProvider.overrideWithValue(backlog),
      themeListProvider.overrideWith((ref) async => themes ?? sampleThemes),
      categoryListProvider.overrideWith((ref) async => const <TaskCategory>[]),
      defaultCategoryIdProvider.overrideWith((ref) async => defaultCategoryId),
    ],
    child: const MaterialApp(home: IdeasScreen()),
  );
}

void main() {
  late FakeIdeaBacklog backlog;

  setUp(() {
    backlog = FakeIdeaBacklog(sampleIdeas);
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byTooltip('フィルター'));
    await tester.pumpAndSettle();
  }

  Finder sheetChip(String label) => find.descendant(
        of: find.byType(BottomSheet),
        matching: find.widgetWithText(FilterChip, label),
      );

  Future<void> tapInSheet(WidgetTester tester, String label) async {
    final chip = sheetChip(label);
    await tester.ensureVisible(chip);
    await tester.tap(chip);
    await tester.pumpAndSettle();
  }

  Future<void> apply(WidgetTester tester) async {
    final button = find.widgetWithText(FilledButton, '適用');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  bool badgeVisible(WidgetTester tester) => tester
      .widget<Badge>(find.descendant(
          of: find.byTooltip('フィルター'), matching: find.byType(Badge)))
      .isLabelVisible;

  testWidgets('初期表示は記憶・☆が無ければ先頭テーマで絞る。バッジは出さず、テーマのチップに × は無い', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    // 全件を取ってからテーマに切り替えるのではなく、最初の取得からテーマで絞る
    expect(backlog.calls.first,
        {'themeId': '10', 'priority': null, 'status': null, 'search': ''});
    expect(badgeVisible(tester), isFalse);
    final chip = tester.widget<InputChip>(find.widgetWithText(InputChip, 'テーマ：スマホアプリ'));
    expect(chip.onDeleted, isNull);
    expect(find.byType(ListTile), findsOneWidget);
    expect(find.text('音声で優先度を変えられるようにする'), findsOneWidget);
  });

  testWidgets('☆カテゴリの ☆テーマが初期選択になる', (tester) async {
    final themes = [
      TaskTheme(id: '10', name: 'スマホアプリ', categoryId: '1'),
      TaskTheme(id: '11', name: 'デスクトップ', categoryId: '1', isDefault: true),
    ];
    await tester.pumpWidget(buildIdeasApp(backlog, themes: themes, defaultCategoryId: '1'));
    await tester.pumpAndSettle();
    expect(backlog.calls.first['themeId'], '11');
    expect(find.text('ホーム画面ウィジェットに今日のタスク'), findsOneWidget);
  });

  testWidgets('「指定なし」の記憶があればテーマ未定のアイデアだけを出す', (tester) async {
    SharedPreferences.setMockInitialValues({FilterSelectionStore.ideaThemeKey: ideaNoThemeId});
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();
    expect(backlog.calls.first['themeId'], 'none');
    expect(find.byType(ListTile), findsOneWidget);
    expect(find.text('通知の既読をまとめて付ける'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'テーマ：指定なし'), findsOneWidget);
  });

  testWidgets('テーマ一覧が取れなければテーマでは絞らず、一覧は出る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog, themes: const []));
    await tester.pumpAndSettle();
    expect(backlog.calls.first['themeId'], isNull);
    expect(find.byType(ListTile), findsNWidgets(3));
    expect(find.text('スマホアプリ'), findsNothing);
  });

  testWidgets('シートのテーマ段に「すべて」は無く「指定なし」は残る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();
    await openSheet(tester);

    expect(sheetChip('指定なし'), findsOneWidget);
    // 「すべて」は状態・優先度の2つだけ（テーマ段には無い）
    expect(sheetChip('すべて'), findsNWidgets(2));
    expect(tester.widget<FilterChip>(sheetChip('スマホアプリ')).selected, isTrue);
    expect(tester.widget<FilterChip>(sheetChip('指定なし')).selected, isFalse);
  });

  testWidgets('シートでテーマ・状態・優先度・キーワードを指定して適用すると一覧が絞られ、テーマを記憶する', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tapInSheet(tester, 'デスクトップ');
    await tapInSheet(tester, '使用済み');
    await tapInSheet(tester, '中');
    await tester.enterText(find.byType(TextField), ' ホーム ');
    await apply(tester);

    expect(backlog.calls.last,
        {'themeId': '11', 'priority': 'medium', 'status': 'used', 'search': 'ホーム'});
    expect(find.byType(ListTile), findsOneWidget);
    expect(badgeVisible(tester), isTrue);
    expect(find.widgetWithText(InputChip, 'テーマ：デスクトップ'), findsOneWidget);
    expect(find.widgetWithText(InputChip, '状態：使用済み'), findsOneWidget);
    expect(find.widgetWithText(InputChip, '優先度：中'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'キーワード：ホーム'), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(FilterSelectionStore.ideaThemeKey), '11');
  });

  testWidgets('「指定なし」を選ぶとテーマ未定のアイデアだけになり、none を記憶する', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();
    await openSheet(tester);
    await tapInSheet(tester, '指定なし');
    await apply(tester);

    expect(backlog.calls.last['themeId'], 'none');
    expect(find.text('通知の既読をまとめて付ける'), findsOneWidget);
    expect(find.byType(ListTile), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(FilterSelectionStore.ideaThemeKey), 'none');
  });

  testWidgets('適用中のチップの × で個別に外せ、テーマ以外を全部外すとバッジも消える（テーマは残る）', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tapInSheet(tester, '未使用');
    await apply(tester);
    expect(badgeVisible(tester), isTrue);

    await tester.tap(find.byTooltip('状態の絞り込みを解除'));
    await tester.pumpAndSettle();
    expect(backlog.calls.last, {'themeId': '10', 'priority': null, 'status': null, 'search': ''});
    expect(find.byType(InputChip), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'テーマ：スマホアプリ'), findsOneWidget);
    expect(badgeVisible(tester), isFalse);
  });

  testWidgets('0件は専用の表示になり、「フィルターを解除」でもテーマは残る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tester.enterText(find.byType(TextField), '存在しない');
    await apply(tester);

    expect(find.text('条件に合うアイデアはありません'), findsOneWidget);
    expect(find.text('アイデアはありません'), findsNothing);

    await tester.tap(find.text('フィルターを解除'));
    await tester.pumpAndSettle();
    expect(backlog.calls.last['themeId'], '10');
    expect(find.byType(ListTile), findsOneWidget);
    expect(badgeVisible(tester), isFalse);
  });

  testWidgets('テーマ以外の絞り込みなしで0件なら通常の空表示', (tester) async {
    await tester.pumpWidget(buildIdeasApp(FakeIdeaBacklog(const [])));
    await tester.pumpAndSettle();
    expect(find.text('アイデアはありません'), findsOneWidget);
    expect(find.text('条件に合うアイデアはありません'), findsNothing);
  });

  testWidgets('シートのクリアはテーマ以外を初期条件に戻す', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tapInSheet(tester, '低');
    await apply(tester);

    await openSheet(tester);
    // 前回の条件がシートに残っている
    expect(tester.widget<FilterChip>(sheetChip('低')).selected, isTrue);
    final clear = find.widgetWithText(TextButton, 'クリア');
    await tester.ensureVisible(clear);
    await tester.tap(clear);
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(tester.element(find.byType(IdeasScreen)));
    expect(container.read(ideaFilterProvider), const IdeaFilter(themeId: '10'));
  });

  testWidgets('行タップ → 「テーマを変更」でテーマを選ぶと PATCH し、「指定なし」は解除（null）で送る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await tester.tap(find.text('音声で優先度を変えられるようにする'));
    await tester.pumpAndSettle();
    expect(find.text('現在：スマホアプリ'), findsOneWidget);
    await tester.tap(find.text('テーマを変更'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'デスクトップ'));
    await tester.pumpAndSettle();
    expect(backlog.themeUpdates, [('1', '11')]);
    expect(find.text('テーマを変更しました'), findsOneWidget);

    await tester.tap(find.text('音声で優先度を変えられるようにする'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('テーマを変更'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, '指定なし'));
    await tester.pumpAndSettle();
    expect(backlog.themeUpdates.last, ('1', null));
  });
}
