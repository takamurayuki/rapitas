/// Tasks screen inline search (nav71): the search field is always above the
/// list (no search icon, no search mode), results from the server search
/// replace the list in place, the applied-filter chips hide while a query is
/// present, stale results never overwrite newer ones, loading / no-match /
/// failure + retry keep their states, and clearing returns to the list.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'task_filter_selection_test.dart' show FakeTaskList, buildTaskListApp, sampleTasks;

/// 検索の応答を語句ごとに止められる偽物（世代管理を見るため）
class _SearchableTasks extends FakeTaskList {
  final List<String> queries = [];
  final Map<String, Completer<List<Task>>> gates = {};

  _SearchableTasks() : super(sampleTasks);

  @override
  Future<List<Task>> searchTasks(String query) async {
    queries.add(query);
    final gate = gates[query];
    if (gate != null) return gate.future;
    // 全テーマ対象（一覧の絞り込みとは別軸）
    return tasks.where((t) => t.title.contains(query)).toList();
  }
}

final _field = find.byKey(const ValueKey('task-search-field'));

TextField _textField(WidgetTester tester) => tester.widget<TextField>(_field);

Future<void> _pump(WidgetTester tester, _SearchableTasks service) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(buildTaskListApp(service));
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(_field, text);
  await tester.pump(const Duration(milliseconds: 300)); // デバウンス
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('検索欄は一覧の上に常にあり、検索アイコンは無い。自動フォーカスしない', (tester) async {
    await _pump(tester, _SearchableTasks());

    expect(_field, findsOneWidget);
    expect(find.byTooltip('検索'), findsNothing);
    expect(find.byTooltip('検索を閉じる'), findsNothing);
    expect(_textField(tester).autofocus, isFalse);
    expect(_textField(tester).decoration!.hintText, 'タスクを検索');
    expect(_textField(tester).decoration!.border, isA<OutlineInputBorder>());
    expect(find.byKey(const ValueKey('task-search-clear')), findsNothing, reason: '入力が無いときはクリアを出さない');
    expect(find.byType(FloatingActionButton), findsOneWidget);
    // 並びは 検索欄 → 適用中チップ列 → 一覧
    final chip = find.widgetWithText(InputChip, 'テーマ：開発 › スマホアプリ');
    expect(tester.getTopLeft(_field).dy, lessThan(tester.getTopLeft(chip).dy));
    expect(tester.getTopLeft(chip).dy, lessThan(tester.getTopLeft(find.text('フィルターの初期選択')).dy));
  });

  testWidgets('入力すると300ms後にサーバ検索し、一覧の場所に結果を出す。チップ列は隠し、FABは出したまま', (tester) async {
    final service = _SearchableTasks();
    await _pump(tester, service);
    expect(find.text('単語帳 100 語'), findsNothing, reason: '一覧はテーマで絞られている');

    await tester.enterText(_field, '単語');
    await tester.pump(const Duration(milliseconds: 200));
    expect(service.queries, isEmpty, reason: 'デバウンス中は検索しない');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
    expect(service.queries, ['単語']);
    expect(find.text('単語帳 100 語'), findsOneWidget, reason: '検索は全テーマ対象');
    expect(find.text('フィルターの初期選択'), findsNothing, reason: '一覧は結果に置き換わる');
    expect(find.byType(InputChip), findsNothing);
    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(find.byKey(const ValueKey('task-search-clear')), findsOneWidget);

    // クリアで通常の絞り込み一覧とチップ列に戻る
    await tester.tap(find.byKey(const ValueKey('task-search-clear')));
    await tester.pumpAndSettle();
    expect(_textField(tester).controller!.text, isEmpty);
    expect(find.text('単語帳 100 語'), findsNothing);
    expect(find.text('フィルターの初期選択'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'テーマ：開発 › スマホアプリ'), findsOneWidget);
  });

  testWidgets('入力を空に戻すと一覧に戻り、0件は「見つかりませんでした」', (tester) async {
    await _pump(tester, _SearchableTasks());
    await _type(tester, '存在しない語');
    expect(find.text('見つかりませんでした'), findsOneWidget);
    expect(find.text('タスクはありません'), findsNothing, reason: '一覧の空表示とは区別する');

    await _type(tester, '');
    expect(find.text('見つかりませんでした'), findsNothing);
    expect(find.text('フィルターの初期選択'), findsOneWidget);
  });

  testWidgets('読み込み中・失敗＋再試行。引っ張って更新でも現在の語句で検索し直す', (tester) async {
    final service = _SearchableTasks();
    await _pump(tester, service);
    service.gates['資料'] = Completer();
    await tester.enterText(_field, '資料');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    service.gates.remove('資料')!.completeError(Exception('search failed'));
    await tester.pumpAndSettle();
    expect(find.text('検索に失敗しました'), findsOneWidget);

    await tester.tap(find.text('再試行'));
    await tester.pumpAndSettle();
    expect(service.queries, ['資料', '資料']);
    expect(find.text('検索に失敗しました'), findsNothing);

    await tester.fling(find.text('見つかりませんでした'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(service.queries, ['資料', '資料', '資料'], reason: '検索語がある間の引っ張って更新は再検索');
  });

  testWidgets('古い検索の結果で新しい結果を上書きしない', (tester) async {
    final service = _SearchableTasks();
    await _pump(tester, service);
    final slow = service.gates['ホーム'] = Completer();
    await tester.enterText(_field, 'ホーム');
    await tester.pump(const Duration(milliseconds: 300));
    await _type(tester, 'リリース');
    expect(find.text('リリース手順の整理'), findsOneWidget);

    slow.complete([sampleTasks[1]]);
    await tester.pumpAndSettle();
    expect(find.text('ホーム画面の不具合'), findsNothing);
    expect(find.text('リリース手順の整理'), findsOneWidget);
  });
}
