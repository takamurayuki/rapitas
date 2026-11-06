import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import 'service_providers.dart';

final themeListProvider = FutureProvider<List<TaskTheme>>((ref) async {
  final service = ref.watch(themeServiceProvider);
  return service.getThemes();
});
