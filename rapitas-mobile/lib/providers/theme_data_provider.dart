import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import 'service_providers.dart';

final themeListProvider = FutureProvider<List<TaskTheme>>((ref) async {
  final service = ref.watch(themeServiceProvider);
  return service.getThemes();
});

/// カテゴリ一覧（GET /categories。sortOrder 昇順、各行に themeCount あり）
final categoryListProvider = FutureProvider<List<TaskCategory>>((ref) async {
  final service = ref.watch(categoryServiceProvider);
  return service.getCategories();
});
