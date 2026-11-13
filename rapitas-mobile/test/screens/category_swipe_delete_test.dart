import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/categories/categories_screen.dart';
import 'package:rapitas_mobile/screens/categories/category_delete_row.dart';
import 'package:rapitas_mobile/services/category_service.dart';

// カテゴリ画面の横スワイプ削除。初期投入の「開発」「学習」（isDefault）も、確認ダイアログを経て
// DELETE /categories/:id で消せる（以前はスマホに削除の操作自体が無く、バックエンドも拒否していた）。

class FakeCategoryDelete implements CategoryService {
  List<TaskCategory> categories = [
    TaskCategory(id: '1', name: '開発', color: '#3B82F6', sortOrder: 0, mode: 'development', isDefault: true),
    TaskCategory(id: '2', name: '学習', color: '#10B981', sortOrder: 1, mode: 'learning', isDefault: true),
    TaskCategory(id: '3', name: '仕事', color: '#F59E0B', sortOrder: 2),
  ];
  final List<String> deleted = [];
  bool fail = false;

  @override
  Future<List<TaskCategory>> getCategories() async => categories;

  @override
  Future<String?> getDefaultCategoryId() async => null;

  @override
  Future<void> deleteCategory(String id) async {
    if (fail) throw Exception('500');
    deleted.add(id);
    categories = [for (final c in categories) if (c.id != id) c];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<FakeCategoryDelete> pumpScreen(WidgetTester tester, [FakeCategoryDelete? service]) async {
  final fake = service ?? FakeCategoryDelete();
  await tester.pumpWidget(ProviderScope(
    overrides: [categoryServiceProvider.overrideWithValue(fake)],
    child: const MaterialApp(home: CategoriesScreen()),
  ));
  await tester.pumpAndSettle();
  return fake;
}

// 名前で探すとモードのラベル（開発／学習）とも一致するので、行は key で探す
Finder row(String id) => find.byKey(ValueKey('category-row-$id'));

Future<void> swipe(WidgetTester tester, String id) async {
  await tester.drag(row(id), const Offset(-600, 0));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('初期投入カテゴリ「開発」をスワイプ→確認で削除でき、一覧から消える', (tester) async {
    final fake = await pumpScreen(tester);

    await swipe(tester, '1');
    expect(find.text(categoryDeleteMessage(fake.categories.first)), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, '削除'));
    await tester.pumpAndSettle();

    expect(fake.deleted, ['1']);
    expect(row('1'), findsNothing);
    expect(row('2'), findsOneWidget);
    expect(find.text('カテゴリを削除しました'), findsOneWidget);
  });

  testWidgets('確認でキャンセルすると削除しない', (tester) async {
    final fake = await pumpScreen(tester);

    await swipe(tester, '2');
    await tester.tap(find.widgetWithText(TextButton, 'キャンセル'));
    await tester.pumpAndSettle();

    expect(fake.deleted, isEmpty);
    expect(row('2'), findsOneWidget);
  });

  testWidgets('削除に失敗したら行は残り、失敗を伝える', (tester) async {
    final fake = await pumpScreen(tester, FakeCategoryDelete()..fail = true);

    await swipe(tester, '3');
    await tester.tap(find.widgetWithText(TextButton, '削除'));
    await tester.pumpAndSettle();

    expect(fake.deleted, isEmpty);
    expect(row('3'), findsOneWidget);
    expect(find.textContaining('カテゴリの削除に失敗しました'), findsOneWidget);
  });
}
