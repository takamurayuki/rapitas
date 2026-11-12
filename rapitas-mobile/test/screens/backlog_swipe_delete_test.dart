import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/backlog/concerns_screen.dart';
import 'package:rapitas_mobile/screens/backlog/hypotheses_screen.dart';
import 'package:rapitas_mobile/screens/backlog/ideas_screen.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';

// バックログ3画面（アイデア・懸念・仮説）の横スワイプ削除。
// 行に削除ボタンを置かず、右から左へのスワイプ→確認ダイアログ→削除、の流れを確かめる。

/// 削除を記録し、成功時は手元の一覧から消す BacklogService。
class FakeSwipeBacklog implements BacklogService {
  final List<Idea> ideas;
  final List<Concern> concerns;
  final List<Hypothesis> hypotheses;
  final List<String> deleted = [];

  /// true なら削除リクエストを失敗させる
  bool failDelete = false;

  FakeSwipeBacklog({
    this.ideas = const [],
    this.concerns = const [],
    this.hypotheses = const [],
  });

  Future<void> _delete(String kind, String id, List<dynamic> list, String Function(dynamic) idOf) async {
    deleted.add('$kind:$id');
    if (failDelete) throw Exception('サーバーエラー');
    list.removeWhere((e) => idOf(e) == id);
  }

  @override
  Future<List<Idea>> getIdeas({String? themeId, String? priority, String? status, String? search}) async =>
      List.of(ideas);

  @override
  Future<List<Concern>> getConcerns() async => List.of(concerns);

  @override
  Future<List<Hypothesis>> getHypotheses() async => List.of(hypotheses);

  @override
  Future<void> deleteIdea(String id) => _delete('idea', id, ideas, (e) => (e as Idea).id);

  @override
  Future<void> deleteConcern(String id) => _delete('concern', id, concerns, (e) => (e as Concern).id);

  @override
  Future<void> deleteHypothesis(String id) => _delete('hypothesis', id, hypotheses, (e) => (e as Hypothesis).id);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

List<Idea> sampleIdeas() => [
      Idea(id: '1', title: '音声で優先度を変える', content: '', priority: 'high', scope: 'project'),
      Idea(id: '2', title: '通知の既読をまとめて付ける', content: '', priority: 'low', scope: 'global'),
    ];

List<Concern> sampleConcerns() => [
      Concern(id: '1', title: '起動が遅い', detail: '', type: 'performance', severity: 'high', status: 'open'),
      Concern(id: '2', title: 'ログが多すぎる', detail: '', type: 'refactor', severity: 'low', status: 'open'),
    ];

List<Hypothesis> sampleHypotheses() => [
      Hypothesis(
        id: '1',
        statement: 'キャッシュで一覧表示が速くなる',
        rationale: '',
        domain: 'mobile',
        status: 'open',
        confidence: 0.6,
      ),
      Hypothesis(
        id: '2',
        statement: '音声入力の誤認識は語彙で減る',
        rationale: '',
        domain: 'voice',
        status: 'open',
        confidence: 0.4,
      ),
    ];

Widget buildApp(FakeSwipeBacklog backlog, Widget screen) {
  return ProviderScope(
    overrides: [
      backlogServiceProvider.overrideWithValue(backlog),
      themeListProvider.overrideWith((ref) async => const []),
    ],
    child: MaterialApp(home: screen),
  );
}

/// 行を右から左へスワイプする（Dismissible の既定しきい値 0.4 を超える距離）
Future<void> swipeLeft(WidgetTester tester, String title) async {
  await tester.drag(find.text(title), const Offset(-600, 0));
  await tester.pumpAndSettle();
}

class _Case {
  final String name;
  final Widget screen;
  final String kind;
  final String firstTitle;
  final String secondTitle;
  final String failureMessage;
  final String successMessage;

  const _Case(this.name, this.screen, this.kind, this.firstTitle, this.secondTitle,
      this.successMessage, this.failureMessage);
}

void main() {
  late FakeSwipeBacklog backlog;

  setUp(() {
    backlog = FakeSwipeBacklog(
      ideas: sampleIdeas(),
      concerns: sampleConcerns(),
      hypotheses: sampleHypotheses(),
    );
  });

  const cases = [
    _Case('アイデア', IdeasScreen(), 'idea', '音声で優先度を変える', '通知の既読をまとめて付ける',
        'アイデアを削除しました', 'アイデアの削除に失敗しました'),
    _Case('懸念', ConcernsScreen(), 'concern', '起動が遅い', 'ログが多すぎる', '懸念を削除しました',
        '懸念の削除に失敗しました'),
    _Case('仮説', HypothesesScreen(), 'hypothesis', 'キャッシュで一覧表示が速くなる', '音声入力の誤認識は語彙で減る',
        '仮説を削除しました', '仮説の削除に失敗しました'),
  ];

  for (final c in cases) {
    group('${c.name}一覧の横スワイプ削除', () {
      testWidgets('行に削除ボタンは無く、スワイプで赤背景のゴミ箱が出る', (tester) async {
        await tester.pumpWidget(buildApp(backlog, c.screen));
        await tester.pumpAndSettle();

        expect(find.byIcon(Icons.delete_outline), findsNothing);
        expect(find.byType(Dismissible), findsNWidgets(2));

        // 途中まで（しきい値未満）引くと背景のゴミ箱が見え、離すと戻る
        final gesture = await tester.startGesture(tester.getCenter(find.text(c.firstTitle)));
        await gesture.moveBy(const Offset(-40, 0));
        await gesture.moveBy(const Offset(-60, 0));
        await tester.pump();
        expect(find.byIcon(Icons.delete), findsOneWidget);
        await gesture.up();
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(backlog.deleted, isEmpty);
      });

      testWidgets('スワイプ→確認ダイアログ→削除で削除が呼ばれ、行が消える', (tester) async {
        await tester.pumpWidget(buildApp(backlog, c.screen));
        await tester.pumpAndSettle();

        await swipeLeft(tester, c.firstTitle);
        expect(find.byType(AlertDialog), findsOneWidget);
        expect(find.textContaining('元に戻せません'), findsOneWidget);
        expect(backlog.deleted, isEmpty, reason: '確認前に削除してはいけない');

        await tester.tap(find.widgetWithText(TextButton, '削除'));
        await tester.pumpAndSettle();

        expect(backlog.deleted, ['${c.kind}:1']);
        expect(find.text(c.firstTitle), findsNothing);
        expect(find.text(c.secondTitle), findsOneWidget);
        expect(find.text(c.successMessage), findsOneWidget);
        expect(tester.takeException(), isNull);
      });

      testWidgets('確認ダイアログでキャンセルすると削除せず、行が元の位置に残る', (tester) async {
        await tester.pumpWidget(buildApp(backlog, c.screen));
        await tester.pumpAndSettle();
        final before = tester.getTopLeft(find.text(c.firstTitle));

        await swipeLeft(tester, c.firstTitle);
        await tester.tap(find.widgetWithText(TextButton, 'キャンセル'));
        await tester.pumpAndSettle();

        expect(backlog.deleted, isEmpty);
        expect(find.text(c.firstTitle), findsOneWidget);
        expect(tester.getTopLeft(find.text(c.firstTitle)), before);
      });

      testWidgets('削除に失敗したら行は元の位置に戻り、失敗をスナックバーで伝える', (tester) async {
        backlog.failDelete = true;
        await tester.pumpWidget(buildApp(backlog, c.screen));
        await tester.pumpAndSettle();
        final before = tester.getTopLeft(find.text(c.firstTitle));

        await swipeLeft(tester, c.firstTitle);
        await tester.tap(find.widgetWithText(TextButton, '削除'));
        await tester.pumpAndSettle();

        expect(backlog.deleted, ['${c.kind}:1']);
        expect(find.text(c.firstTitle), findsOneWidget);
        expect(tester.getTopLeft(find.text(c.firstTitle)), before);
        expect(find.textContaining(c.failureMessage), findsOneWidget);
      });
    });
  }

  testWidgets('仮説の行メニューは状態変更だけで、削除項目は無い', (tester) async {
    await tester.pumpWidget(buildApp(backlog, const HypothesesScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('状態を変更').first);
    await tester.pumpAndSettle();

    expect(find.textContaining('にする'), findsWidgets);
    expect(find.widgetWithText(PopupMenuItem<String>, '削除'), findsNothing);
    expect(find.text('削除'), findsNothing);
  });
}
