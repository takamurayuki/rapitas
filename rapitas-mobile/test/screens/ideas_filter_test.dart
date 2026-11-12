import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/backlog_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/backlog/ideas_screen.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';

/// バックエンドの絞り込みを手元で真似る BacklogService（themeId・priority・status・search）。
class FakeIdeaBacklog implements BacklogService {
  final List<Idea> ideas;
  final List<Map<String, String?>> calls = [];

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
      if (themeId != null && i.themeId != themeId) return false;
      if (priority != null && i.priority != priority) return false;
      if (status == 'used' && i.usedInTaskId == null) return false;
      if (status == 'open' && i.usedInTaskId != null) return false;
      if (search != null && search.isNotEmpty && !i.title.contains(search)) return false;
      return true;
    }).toList();
  }

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

Widget buildIdeasApp(FakeIdeaBacklog backlog, {List<TaskTheme>? themes}) {
  return ProviderScope(
    overrides: [
      backlogServiceProvider.overrideWithValue(backlog),
      themeListProvider.overrideWith((ref) async => themes ?? sampleThemes),
    ],
    child: const MaterialApp(home: IdeasScreen()),
  );
}

void main() {
  late FakeIdeaBacklog backlog;

  setUp(() => backlog = FakeIdeaBacklog(sampleIdeas));

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byTooltip('フィルター'));
    await tester.pumpAndSettle();
  }

  Future<void> tapInSheet(WidgetTester tester, String label) async {
    final chip = find.descendant(
      of: find.byType(BottomSheet),
      matching: find.widgetWithText(FilterChip, label),
    );
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

  testWidgets('初期表示は絞り込みなし・バッジなし。行にテーマ名と使用済みが出る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    expect(backlog.calls.first,
        {'themeId': null, 'priority': null, 'status': null, 'search': ''});
    expect(badgeVisible(tester), isFalse);
    expect(find.byType(InputChip), findsNothing);
    expect(find.byType(ListTile), findsNWidgets(3));
    expect(find.text('スマホアプリ'), findsOneWidget);
    expect(find.text('デスクトップ'), findsOneWidget);
    expect(find.text('使用済み'), findsOneWidget);
  });

  testWidgets('テーマ一覧が取れなければテーマ名は出さず、一覧は出る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog, themes: const []));
    await tester.pumpAndSettle();
    expect(find.byType(ListTile), findsNWidgets(3));
    expect(find.text('スマホアプリ'), findsNothing);
  });

  testWidgets('シートでテーマ・状態・優先度・キーワードを指定して適用すると一覧が絞られる', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tapInSheet(tester, 'スマホアプリ');
    await tapInSheet(tester, '未使用');
    await tapInSheet(tester, '高');
    await tester.enterText(find.byType(TextField), ' 音声 ');
    await apply(tester);

    expect(backlog.calls.last,
        {'themeId': '10', 'priority': 'high', 'status': 'open', 'search': '音声'});
    expect(find.byType(ListTile), findsOneWidget);
    expect(find.text('音声で優先度を変えられるようにする'), findsOneWidget);
    expect(badgeVisible(tester), isTrue);
    expect(find.widgetWithText(InputChip, 'テーマ：スマホアプリ'), findsOneWidget);
    expect(find.widgetWithText(InputChip, '状態：未使用'), findsOneWidget);
    expect(find.widgetWithText(InputChip, '優先度：高'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'キーワード：音声'), findsOneWidget);
  });

  testWidgets('適用中のチップの × で個別に外せ、全部外すとバッジも消える', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tapInSheet(tester, '使用済み');
    await apply(tester);
    expect(find.byType(ListTile), findsOneWidget);

    await tester.tap(find.byTooltip('状態の絞り込みを解除'));
    await tester.pumpAndSettle();
    expect(backlog.calls.last['status'], isNull);
    expect(find.byType(ListTile), findsNWidgets(3));
    expect(find.byType(InputChip), findsNothing);
    expect(badgeVisible(tester), isFalse);
  });

  testWidgets('0件は専用の表示になり、フィルターを解除できる', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tester.enterText(find.byType(TextField), '存在しない');
    await apply(tester);

    expect(find.text('条件に合うアイデアはありません'), findsOneWidget);
    expect(find.text('アイデアはありません'), findsNothing);

    await tester.tap(find.text('フィルターを解除'));
    await tester.pumpAndSettle();
    expect(find.byType(ListTile), findsNWidgets(3));
    expect(badgeVisible(tester), isFalse);
  });

  testWidgets('絞り込みなしで0件なら通常の空表示', (tester) async {
    await tester.pumpWidget(buildIdeasApp(FakeIdeaBacklog(const [])));
    await tester.pumpAndSettle();
    expect(find.text('アイデアはありません'), findsOneWidget);
    expect(find.text('条件に合うアイデアはありません'), findsNothing);
  });

  testWidgets('シートのクリアで初期条件に戻る', (tester) async {
    await tester.pumpWidget(buildIdeasApp(backlog));
    await tester.pumpAndSettle();

    await openSheet(tester);
    await tapInSheet(tester, '低');
    await apply(tester);
    expect(find.byType(ListTile), findsOneWidget);

    await openSheet(tester);
    // 前回の条件がシートに残っている
    final low = tester.widget<FilterChip>(find.descendant(
        of: find.byType(BottomSheet), matching: find.widgetWithText(FilterChip, '低')));
    expect(low.selected, isTrue);
    final clear = find.widgetWithText(TextButton, 'クリア');
    await tester.ensureVisible(clear);
    await tester.tap(clear);
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(tester.element(find.byType(IdeasScreen)));
    expect(container.read(ideaFilterProvider), const IdeaFilter());
    expect(find.byType(ListTile), findsNWidgets(3));
  });
}
