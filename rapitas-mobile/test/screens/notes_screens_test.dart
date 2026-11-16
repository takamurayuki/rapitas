import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/note_paths.dart';
import 'package:rapitas_mobile/config/note_routes.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/notes/notes_screen.dart';
import 'package:rapitas_mobile/widgets/task_notes_section.dart';

import '../support/note_fakes.dart';

// ノートの一覧（横スワイプ削除）・作成・編集と、タスク詳細「資料」節からの作成→紐づけ。
// データはすべてダミー（test/support/note_fakes.dart）。

Task _task(String id) => Task(
      id: id,
      title: 'ダミーのタスク$id',
      theme: TaskTheme(id: '5', name: 'ダミーテーマ'),
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

/// '/'（資料節を置いた仮の画面）とノートのルートだけを持つアプリ
Future<GoRouter> _pumpApp(WidgetTester tester, FakeNoteService service, {String? push}) async {
  final router = GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => Scaffold(
          appBar: AppBar(title: const Text('ホーム（仮）')),
          body: const Padding(padding: EdgeInsets.all(16), child: TaskNotesSection(taskId: '101')),
        ),
      ),
      ...noteRoutes,
    ],
  );
  await tester.pumpWidget(ProviderScope(
    overrides: [
      noteServiceProvider.overrideWithValue(service),
      taskDetailProvider.overrideWith((ref, id) async => _task(id)),
    ],
    child: MaterialApp.router(routerConfig: router),
  ));
  await tester.pumpAndSettle();
  if (push != null) {
    router.push(push);
    await tester.pumpAndSettle();
  }
  return router;
}

Future<void> _swipeLeft(WidgetTester tester, String title) async {
  await tester.drag(find.text(title), const Offset(-600, 0));
  await tester.pumpAndSettle();
}

void main() {
  late FakeNoteService service;

  setUp(() => service = FakeNoteService(dummyNotes()));

  group('ノート一覧', () {
    testWidgets('サーバーの並びのまま出し、ピン留めの印はピン留めの行だけに付く', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.list);

      final titles = ['【ダミー】ノート機能 v1 の画面設計', '【ダミー】定例の議事録', '(無題)'];
      final ys = [for (final t in titles) tester.getTopLeft(find.text(t)).dy];
      expect(ys, orderedEquals([...ys]..sort()), reason: 'サーバーの並び（ピン留め優先・更新順）を並べ替えない');
      expect(find.byIcon(Icons.push_pin), findsOneWidget);
      expect(
        find.descendant(of: find.widgetWithText(ListTile, titles.first), matching: find.byIcon(Icons.push_pin)),
        findsOneWidget,
      );
      // 本文の下見（記号を落とした最初の行）と、種類・紐づくタスク数
      expect(find.text('画面設計'), findsOneWidget);
      expect(find.textContaining('タスク 2件'), findsOneWidget);
      // 常時表示の削除ボタンは置かない
      expect(find.byIcon(Icons.delete_outline), findsNothing);
      expect(find.byType(Dismissible), findsNWidgets(3));
    });

    testWidgets('タップでノート詳細へ進み、詳細の鉛筆から編集画面を開ける', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.list);
      await tester.tap(find.text('【ダミー】定例の議事録'));
      await tester.pumpAndSettle();
      expect(find.text('決まったこと'), findsOneWidget);

      await tester.tap(find.byTooltip('編集'));
      await tester.pumpAndSettle();
      expect(find.text('ノートを編集'), findsOneWidget);
    });

    testWidgets('スワイプ→確認ダイアログ→削除で DELETE が呼ばれ、行が消える', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.list);

      await _swipeLeft(tester, '(無題)');
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.textContaining('紐づくタスクの資料からも外れます'), findsOneWidget);
      expect(service.calls, isEmpty, reason: '確認前に削除してはいけない');

      await tester.tap(find.widgetWithText(TextButton, '削除'));
      await tester.pumpAndSettle();

      expect(service.calls, ['delete:1731400000003']);
      expect(find.text('(無題)'), findsNothing);
      expect(find.text('【ダミー】定例の議事録'), findsOneWidget);
      expect(find.text('ノートを削除しました'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('キャンセルすると削除せず、行が元の位置に残る', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.list);
      final before = tester.getTopLeft(find.text('【ダミー】定例の議事録'));

      await _swipeLeft(tester, '【ダミー】定例の議事録');
      await tester.tap(find.widgetWithText(TextButton, 'キャンセル'));
      await tester.pumpAndSettle();

      expect(service.calls, isEmpty);
      expect(tester.getTopLeft(find.text('【ダミー】定例の議事録')), before);
    });

    testWidgets('削除に失敗したら行は残り、失敗を伝える', (tester) async {
      service.failDelete = true;
      await _pumpApp(tester, service, push: NotePaths.list);

      await _swipeLeft(tester, '【ダミー】定例の議事録');
      await tester.tap(find.widgetWithText(TextButton, '削除'));
      await tester.pumpAndSettle();

      expect(service.calls, ['delete:1731400000002']);
      expect(find.text('【ダミー】定例の議事録'), findsOneWidget);
      expect(find.textContaining('ノートの削除に失敗しました'), findsOneWidget);
    });

    testWidgets('ノートが無ければその旨を出す', (tester) async {
      await _pumpApp(tester, FakeNoteService(), push: NotePaths.list);
      expect(find.text('ノートはまだありません'), findsOneWidget);
    });
  });

  group('作成・編集', () {
    testWidgets('一覧の＋から作ると PUT だけで、タスクへの紐づけはしない', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.list);
      await tester.tap(find.byTooltip('ノートを追加'));
      await tester.pumpAndSettle();
      expect(find.text('新しいノート'), findsOneWidget);
      expect(find.byKey(const ValueKey('note-form-link-target')), findsNothing);

      await tester.enterText(find.byKey(const ValueKey('note-form-title')), '新しいメモ');
      await tester.enterText(find.byKey(const ValueKey('note-form-content')), '# 本文');
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();

      expect(service.calls, hasLength(1));
      expect(service.calls.single, matches(RegExp(r'^save:\d+:新しいメモ:# 本文$')));
      // 一覧に戻り、作ったノートが出ている
      expect(find.text('ノートを作成しました'), findsOneWidget);
      expect(find.text('新しいメモ'), findsOneWidget);
    });

    testWidgets('「資料」節の「資料を追加」から作ると、保存の後にそのタスクへ紐づける', (tester) async {
      await _pumpApp(tester, service);
      expect(find.text('資料 (2)'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('task-notes-add')));
      await tester.pumpAndSettle();
      expect(find.textContaining('「ダミーのタスク101」の資料に追加します'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('note-form-title')), '調査メモ');
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();

      expect(service.calls, hasLength(2));
      final id = RegExp(r'^save:(\d+):調査メモ:$').firstMatch(service.calls[0])!.group(1);
      expect(service.calls[1], 'link:$id:101:ダミーテーマ', reason: '保存した id のノートをタスクに紐づける');
      // タスクの画面に戻り、資料節が読み直されて増えている
      expect(find.text('資料 (3)'), findsOneWidget);
      expect(find.text('調査メモ'), findsOneWidget);
    });

    testWidgets('紐づけだけ失敗したら画面に残り、押し直すと同じ id で保存と紐づけをやり直す', (tester) async {
      service.failLink = true;
      await _pumpApp(tester, service, push: NotePaths.createPath(taskId: '101'));
      await tester.enterText(find.byKey(const ValueKey('note-form-content')), '本文だけ');
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();

      expect(find.textContaining('タスクへの紐づけに失敗しました'), findsOneWidget);
      expect(find.text('新しいノート'), findsOneWidget, reason: '画面を閉じない');

      service.failLink = false;
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();

      final ids = {for (final c in service.calls) c.split(':')[1]};
      expect(ids, hasLength(1), reason: '押し直しても別のノートを作らない');
      expect(service.calls.where((c) => c.startsWith('link:')), hasLength(2));
      expect(service.notes.where((n) => n.content == '本文だけ'), hasLength(1));
      expect(find.text('新しいノート'), findsNothing);
    });

    testWidgets('タイトルも本文も空なら保存しない', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.createPath());
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();
      expect(find.text('タイトルか本文を入力してください'), findsOneWidget);
      expect(service.calls, isEmpty);
    });

    testWidgets('編集は今のタイトルと本文を入れて開き、同じ id に PUT する（紐づけはしない）', (tester) async {
      await _pumpApp(tester, service, push: NotePaths.editPath('1731400000002'));
      expect(find.text('【ダミー】定例の議事録'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('note-form-title')), '定例の議事録（改）');
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();

      expect(service.calls, hasLength(1));
      expect(service.calls.single, startsWith('save:1731400000002:定例の議事録（改）:## 決まったこと'));
      expect(find.text('ノートを保存しました'), findsOneWidget);
      // 種類は送っていないので残る
      expect(service.notes.firstWhere((n) => n.id == '1731400000002').docType, '議事録');
    });

    testWidgets('保存に失敗したら画面に残り、失敗を伝える', (tester) async {
      service.failSave = true;
      await _pumpApp(tester, service, push: NotePaths.createPath(taskId: '101'));
      await tester.enterText(find.byKey(const ValueKey('note-form-title')), 'x');
      await tester.tap(find.byKey(const ValueKey('note-form-save')));
      await tester.pumpAndSettle();

      expect(find.textContaining('ノートの保存に失敗しました'), findsOneWidget);
      expect(service.calls.where((c) => c.startsWith('link:')), isEmpty, reason: '保存できていないのに紐づけない');
      expect(find.text('新しいノート'), findsOneWidget);
    });
  });

  test('notePreviewLine は見出し・箇条書き・引用の記号とコードの柵を落とす', () {
    expect(notePreviewLine('# 見出し\n本文'), '見出し');
    expect(notePreviewLine('\n\n- [x] 済んだ項目'), '済んだ項目');
    expect(notePreviewLine('```mermaid\n> 引用'), '引用');
    expect(notePreviewLine('1. 番号'), '番号');
    expect(notePreviewLine(''), '');
  });

  test('createPath は taskId をクエリで渡す', () {
    expect(NotePaths.createPath(), '/notes/new');
    expect(NotePaths.createPath(taskId: '101'), '/notes/new?taskId=101');
    expect(NotePaths.editPath('a b'), '/notes/a%20b/edit');
  });
}
